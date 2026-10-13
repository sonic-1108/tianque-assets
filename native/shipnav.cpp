// 怒海战船 AI navigation, in C++ compiled to WebAssembly (see native/build.sh).
//
// The same walk graph as src/shipNav.ts builds in JavaScript: every 0.5 m cell on every floor surface of the
// ship is a node; you can step to a neighbouring cell when nothing blocks you there and the floor you'd land on is
// at most a step up (stepping or dropping down is fine). Stairs, doors, the hatch and the ways round crates fall
// out of that by themselves. A* finds the way between two nodes.
//
// Freestanding: no libc, no allocator. Everything lives in fixed static arrays; JavaScript writes the boxes,
// crates and seed points into the input buffers, calls nav_build once, then nav_nearest / nav_path as it likes.

typedef unsigned int u32;
typedef unsigned long long u64;

#define EXPORT extern "C" __attribute__((visibility("default")))

static const float CELL = 0.5f;
static const float STEP = 0.6f;
static const float R = 0.4f; // keep this far from walls (fighters are 0.38)

static const int MAXBOX = 1024;
static const int MAXPIL = 128;
static const int MAXSEED = 32;
static const int MAXCELL = 16384;
static const int MAXNEAR = 262144;
static const int MAXN = 65536;
static const int MAXE = MAXN * 8;
static const int HASH = 1 << 18;

// ---- inputs (filled by JavaScript)
// box: x0 x1 y0 y1 z0 z1 kind (1 = stair tread)
static float boxes[MAXBOX * 7];
// crate / post: x z r top bottom
static float pills[MAXPIL * 5];
static float seeds[MAXSEED * 3];
static int nBox, nPil;
static float HX, HZ, HOLDY;
static int NX, NZ;

// ---- boxes near each cell (CSR)
static int nearStart[MAXCELL + 1];
static int nearList[MAXNEAR];

// ---- the graph
static float px[MAXN], py[MAXN], pz[MAXN];
static int cellOf[MAXN];
static int nNode;
static int eStart[MAXN + 1];
static int eTo[MAXE];
static float eCost[MAXE];
static int tmpTo[MAXN][8];
static float tmpCost[MAXN][8];
static unsigned char tmpN[MAXN];
static unsigned char brink[MAXN];
static int cellNodes[MAXCELL][8];
static unsigned char cellCount[MAXCELL];

// ---- node lookup: (cell, height) -> node
static u64 hKey[HASH];
static int hVal[HASH];

static inline float fabsf_(float v) { return v < 0 ? -v : v; }
static inline float floorf_(float v) { return __builtin_floorf(v); }
static inline float roundf_(float v) { return __builtin_floorf(v + 0.5f); } // like Math.round
static inline float sqrtf_(float v) { return __builtin_sqrtf(v); }
static inline float hypot2(float a, float b) { return sqrtf_(a * a + b * b); }
static inline float cx(int i) { return -HX + i * CELL; }
static inline float cz(int j) { return -HZ + j * CELL; }

static inline bool inXZ(const float* b, float x, float z, float r) { return x > b[0] - r && x < b[1] + r && z > b[4] - r && z < b[5] + r; }

static float floorAt(int c, float x, float z, float y) {
  float g = HOLDY;
  for (int k = nearStart[c]; k < nearStart[c + 1]; k++) {
    const float* b = boxes + nearList[k] * 7;
    if (b[3] <= y + STEP && b[3] > g && inXZ(b, x, z, 0)) g = b[3];
  }
  return g;
}

static bool blocked(int c, float x, float z, float y) {
  for (int k = nearStart[c]; k < nearStart[c + 1]; k++) {
    const float* b = boxes + nearList[k] * 7;
    if (b[3] > y + 0.55f && b[2] < y + 1.75f && inXZ(b, x, z, b[6] > 0.5f ? 0.05f : R)) return true;
  }
  for (int k = 0; k < nPil; k++) {
    const float* p = pills + k * 5;
    if (y < p[3] - 0.45f && y + 1.75f > p[4] && hypot2(x - p[0], z - p[1]) < p[2] + R) return true;
  }
  return false;
}

static u64 keyOf(int c, float y) { return (u64)c * 4096ull + (u64)(long long)roundf_((y + 8.0f) * 100.0f); }

static int queue[MAXN];
static int qn;

static int add(int c, float y) {
  u64 k = keyOf(c, y) + 1; // 0 marks an empty slot
  u32 h = (u32)((k * 0x9E3779B97F4A7C15ull) >> 46) & (HASH - 1);
  while (hKey[h] && hKey[h] != k) h = (h + 1) & (HASH - 1);
  if (hKey[h] == k) return hVal[h];
  if (nNode >= MAXN) return -1;
  int id = nNode++;
  hKey[h] = k;
  hVal[h] = id;
  px[id] = cx(c % NX);
  py[id] = y;
  pz[id] = cz(c / NX);
  cellOf[id] = c;
  tmpN[id] = 0;
  queue[qn++] = id;
  if (cellCount[c] < 8) cellNodes[c][cellCount[c]++] = id; // one per floor: up to six storeys stacked
  return id;
}

static const float NONE = -1e9f;
static float stepTo(int i, int j, int di, int dj, float y) {
  int ii = i + di, jj = j + dj;
  if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) return NONE;
  int c = jj * NX + ii;
  float x = cx(ii), z = cz(jj);
  float f = floorAt(c, x, z, y);
  // a cell is coarser than a stair tread: going up, judge it standing on the new step
  if (blocked(c, x, z, y > f ? y : f)) return NONE;
  if (f < y && blocked(c, x, z, f)) return NONE;
  return f;
}

EXPORT float* boxes_buf() { return boxes; }
EXPORT float* pillars_buf() { return pills; }
EXPORT float* seeds_buf() { return seeds; }

/** build the graph; returns the number of nodes */
EXPORT int nav_build(int nb, int np, int ns, float hx, float hz, float holdY) {
  nBox = nb < MAXBOX ? nb : MAXBOX;
  nPil = np < MAXPIL ? np : MAXPIL;
  HX = hx;
  HZ = hz;
  HOLDY = holdY;
  NX = (int)floorf_(hx * 2 / CELL) + 1;
  NZ = (int)floorf_(hz * 2 / CELL) + 1;
  int cells = NX * NZ;
  if (cells > MAXCELL) return -1;
  // boxes near each cell: count, then fill
  for (int c = 0; c <= cells; c++) nearStart[c] = 0;
  for (int pass = 0; pass < 2; pass++) {
    for (int b = 0; b < nBox; b++) {
      const float* B = boxes + b * 7;
      int i0 = (int)floorf_((B[0] - R + hx) / CELL), i1 = (int)__builtin_ceilf((B[1] + R + hx) / CELL);
      int j0 = (int)floorf_((B[4] - R + hz) / CELL), j1 = (int)__builtin_ceilf((B[5] + R + hz) / CELL);
      if (i0 < 0) i0 = 0;
      if (j0 < 0) j0 = 0;
      if (i1 > NX - 1) i1 = NX - 1;
      if (j1 > NZ - 1) j1 = NZ - 1;
      for (int j = j0; j <= j1; j++)
        for (int i = i0; i <= i1; i++) {
          int c = j * NX + i;
          if (pass == 0) nearStart[c + 1]++;
          else if (nearStart[c + 1] < MAXNEAR) nearList[nearStart[c + 1]++] = b;
        }
    }
    if (pass == 0) {
      // prefix sums; nearStart[c+1] is reused as the fill cursor in the second pass
      for (int c = 0; c < cells; c++) nearStart[c + 1] += nearStart[c];
      for (int c = cells; c > 0; c--) nearStart[c] = nearStart[c - 1];
      nearStart[0] = 0;
    }
  }
  // after the second pass nearStart[c+1] points one past cell c's entries, i.e. exactly the CSR end; nearStart[0] = 0
  for (int h = 0; h < HASH; h++) hKey[h] = 0;
  for (int c = 0; c < cells; c++) cellCount[c] = 0;
  nNode = 0;
  qn = 0;
  for (int s = 0; s < ns && s < MAXSEED; s++) {
    float x = seeds[s * 3], z = seeds[s * 3 + 1], y = seeds[s * 3 + 2];
    int i = (int)roundf_((x + hx) / CELL), j = (int)roundf_((z + hz) / CELL);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
    int c = j * NX + i;
    float f = floorAt(c, cx(i), cz(j), y);
    if (!blocked(c, cx(i), cz(j), f)) add(c, f);
  }
  static const int D8[8][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
  while (qn > 0) {
    int id = queue[--qn];
    int i = cellOf[id] % NX, j = cellOf[id] / NX;
    float y = py[id];
    for (int d = 0; d < 8; d++) {
      int di = D8[d][0], dj = D8[d][1];
      if (di && dj && (stepTo(i, j, di, 0, y) == NONE || stepTo(i, j, 0, dj, y) == NONE)) continue; // never cut a corner
      float f = stepTo(i, j, di, dj, y);
      if (f == NONE) continue;
      int to = add((j + dj) * NX + (i + di), f);
      if (to < 0) continue;
      float w = (di && dj ? 1.414f : 1.0f) * CELL;
      // dropping off a deck is allowed but discouraged
      if (y - f > STEP) w += 2 + (y - f) * 0.4f;
      tmpTo[id][tmpN[id]] = to;
      tmpCost[id][tmpN[id]] = w;
      tmpN[id]++;
    }
  }
  // cells at the brink of a drop cost extra, so paths keep to the middle of stairs and decks
  for (int k = 0; k < nNode; k++) {
    brink[k] = 0;
    for (int e = 0; e < tmpN[k]; e++)
      if (py[k] - py[tmpTo[k][e]] > STEP) brink[k] = 1;
  }
  int m = 0;
  for (int k = 0; k < nNode; k++) {
    eStart[k] = m;
    for (int e = 0; e < tmpN[k]; e++) {
      eTo[m] = tmpTo[k][e];
      eCost[m] = tmpCost[k][e] + (brink[tmpTo[k][e]] ? 0.9f : 0);
      m++;
    }
  }
  eStart[nNode] = m;
  return nNode;
}

EXPORT float* nav_px() { return px; }
EXPORT float* nav_py() { return py; }
EXPORT float* nav_pz() { return pz; }
EXPORT int nav_edges() { return eStart[nNode]; }

/** the node nearest a fighter at x, y, z: on a floor at or below their feet */
EXPORT int nav_nearest(float x, float y, float z) {
  int i = (int)roundf_((x + HX) / CELL), j = (int)roundf_((z + HZ) / CELL);
  int best = -1;
  float bd = 1e9f;
  for (int r = 0; r <= 5 && (best < 0 || r <= 1); r++)
    for (int dj = -r; dj <= r; dj++)
      for (int di = -r; di <= r; di++) {
        int adi = di < 0 ? -di : di, adj = dj < 0 ? -dj : dj;
        if ((adi > adj ? adi : adj) != r) continue;
        int ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
        int c = jj * NX + ii;
        for (int n = 0; n < cellCount[c]; n++) {
          int k = cellNodes[c][n];
          float dy = py[k] - y;
          if (dy > 0.7f) continue;
          float d = hypot2(px[k] - x, pz[k] - z) + fabsf_(dy) * 1.5f;
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
      }
  return best;
}

// ---- A*
static float gs[MAXN];
static int from[MAXN];
static unsigned char closed[MAXN];
static float heapF[MAXE];
static int heapN[MAXE];
static int hn;
static int pathBuf[MAXN];

static void push(float f, int k) {
  int c = hn++;
  heapF[c] = f;
  heapN[c] = k;
  while (c > 0) {
    int p = (c - 1) >> 1;
    if (heapF[p] <= heapF[c]) break;
    float tf = heapF[p];
    heapF[p] = heapF[c];
    heapF[c] = tf;
    int tn = heapN[p];
    heapN[p] = heapN[c];
    heapN[c] = tn;
    c = p;
  }
}
static int pop() {
  int k = heapN[0];
  hn--;
  if (hn > 0) {
    heapF[0] = heapF[hn];
    heapN[0] = heapN[hn];
    int c = 0;
    for (;;) {
      int l = c * 2 + 1, r = l + 1, m = c;
      if (l < hn && heapF[l] < heapF[m]) m = l;
      if (r < hn && heapF[r] < heapF[m]) m = r;
      if (m == c) break;
      float tf = heapF[m];
      heapF[m] = heapF[c];
      heapF[c] = tf;
      int tn = heapN[m];
      heapN[m] = heapN[c];
      heapN[c] = tn;
      c = m;
    }
  }
  return k;
}

EXPORT int* nav_path_buf() { return pathBuf; }

/** A* from node a to node b: the path's length in pathBuf, 0 when there's no way */
EXPORT int nav_path(int a, int b) {
  if (a < 0 || b < 0 || a >= nNode || b >= nNode) return 0;
  if (a == b) {
    pathBuf[0] = a;
    return 1;
  }
  for (int k = 0; k < nNode; k++) {
    gs[k] = 1e30f;
    from[k] = -1;
    closed[k] = 0;
  }
  hn = 0;
  float bx = px[b], by = py[b], bz = pz[b];
  gs[a] = 0;
  push(hypot2(px[a] - bx, pz[a] - bz) + fabsf_(py[a] - by) * 1.2f, a);
  while (hn > 0) {
    int k = pop();
    if (closed[k]) continue;
    if (k == b) break;
    closed[k] = 1;
    for (int e = eStart[k]; e < eStart[k + 1]; e++) {
      int t = eTo[e];
      float v = gs[k] + eCost[e];
      if (v < gs[t]) {
        gs[t] = v;
        from[t] = k;
        if (hn < MAXE) push(v + hypot2(px[t] - bx, pz[t] - bz) + fabsf_(py[t] - by) * 1.2f, t);
      }
    }
  }
  if (from[b] < 0) return 0;
  int n = 0;
  for (int k = b; k >= 0 && n < MAXN; k = from[k]) pathBuf[n++] = k;
  // reverse in place
  for (int l = 0, r = n - 1; l < r; l++, r--) {
    int t = pathBuf[l];
    pathBuf[l] = pathBuf[r];
    pathBuf[r] = t;
  }
  return n;
}
