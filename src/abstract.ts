// 抽象路线 (owner: "让大家玩的笑死"): the silly lines. Death lines over whoever goes down, quips over whoever casts,
// and the round banner as an offer letter or a rejection. Pure text, no game rules here.

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

const KILL: Record<string, string[]> = {
  Berserker: ['{v}被狂刃一刀砍成了表情包', '{v}：我只是路过的', '狂刃血怒中，{v}已读不回（永久）', '{v}被砍到怀疑人生，然后没有然后了'],
  Ranger: ['{v}的快递已签收：一枚飞镖', '{v}没看见暗器，暗器看见了{v}', '{v}被射成了刺猬，还挺可爱'],
  BuddhistMage: ['{v}被金刚掌拍成了二维', '梵音超度了{v}，功德费另算', '{v}：家人们谁懂啊，被和尚打死了'],
  Shadowblade: ['{v}到死都不知道是谁干的', '{v}：刚刚是不是有什么东西过去了', '{v}被背刺了，像极了职场'],
  Emperor: ['{v}被传国玉玺砸中，享受了皇家待遇', '天子说：拖下去。{v}被拖下去了', '{v}抗旨不遵，当场去世'],
  Trader: ['{v}被劳力士砸死，年化收益 -100%', '{v}被做空到退市', '{v}爆仓了，追加保证金失败', '{v}踩到钱滑倒，人生第一次被钱砸死'],
  HeavyHealer: ['{v}被一个会回血的老头打死了，丢人', '地仙打完收工，去跳广场舞了。{v}躺着', '{v}：年轻人不讲武德，老年人更不讲'],
  Wanderer: ['{v}输给了一个技能全靠借的散人', '{v}被新人教育了，建议卸载重装', '散人用别人的招打赢了{v}，版权费没给'],
  Guard: ['{v}被御林军按在地上摩擦', '{v}：护驾护到我头上了'],
};
const ENV: Record<string, string[]> = {
  摔落: ['{v}试图验证重力，验证成功', '{v}以为自己会轻功'],
  坠落: ['{v}试图验证重力，验证成功', '{v}跳楼了，不是股市的那种'],
  落水: ['{v}忘了自己不会游泳', '{v}下河摸鱼，被鱼摸了'],
  火柱: ['{v}下岩浆洗了个澡，没出来', '{v}烤至全熟'],
  火山弹: ['{v}被火山点名了', '{v}烤至全熟'],
  雷击: ['{v}被雷劈了，大概是欠了谁钱', '{v}渡劫失败'],
  烟花: ['{v}成了今晚最亮的烟花'],
  捕兽夹: ['{v}踩夹子了，猎户今晚加餐'],
};
const ANY = [
  '{v}倒下了，遗言：这把是网卡', '{v}倒下了，遗言：我手柄没电了', '{v}卒，享年不详', '{v}：我还会回来的（不会）',
  '{v}绷不住了', '{v}破防了，物理意义上的', '{v}：小丑竟是我自己', '{v}已躺平，主打一个摆烂', '{v}：这合理吗',
  '{v}被打出了 GDP', '{v}的人生进入了熊市', '{v}：我真的会谢', '{v}已下线，原因：菜', '{v}飞走了，记得给个好评',
];

/** a line for someone going down: by whose hand (class) or what in the world (envHit's label) */
export function deathLine(victim: string, killerClass?: string, env?: string): string {
  const pool = (env && ENV[env]) || (killerClass && KILL[killerClass]) || ANY;
  return pick(Math.random() < 0.15 ? ANY : pool).split('{v}').join(victim);
}

const CAST: Record<string, { skill: string[]; ult: string[] }> = {
  Berserker: { skill: ['啊啊啊啊啊', '给我倒!', '莽就完事了'], ult: ['我要打十个', '谁也别拦我'] },
  Ranger: { skill: ['看镖!', '这把我C', '没瞄，随便扔的'], ult: ['全体目光向我看齐'] },
  BuddhistMage: { skill: ['阿弥陀佛', '家人们谁懂啊', '施主别跑'], ult: ['功德 +1 +1 +1', '万佛朝宗，在线超度'] },
  Shadowblade: { skill: ['你看不见我', '绕后绕后', '我在你身后'], ult: ['我是影子我怕谁'] },
  Emperor: { skill: ['朕准了', '拖出去', '平身'], ult: ['天下都是朕的', '退朝!'] },
  Trader: { skill: ['梭哈!', '这波稳赚', 'All in', '割韭菜了'], ult: ['黑色星期一，大家一起亏', '熔断!'] },
  HeavyHealer: { skill: ['年轻人不讲武德', '老夫先回个血', '耗子尾汁'], ult: ['广场舞时间到', '最炫民族风，放!'] },
  Wanderer: { skill: ['借你的招用用', '学会了', '这招是谁的来着'], ult: ['我也不知道这招是谁的'] },
};
/** a quip over someone casting (null most of the time, always one for an ultimate) */
export function castLine(classId: string, req: string): string | null {
  const c = CAST[classId];
  if (!c) return null;
  if (req === 'ultimate') return pick(c.ult);
  if (!req.startsWith('skill') || Math.random() > 0.3) return null;
  return pick(c.skill);
}

const WIN = ['MD：下周一来上班', 'Super Day 通过，offer 已发', '年终奖到账，三个月', '老板说你是公司的未来'];
const LOSE = ['感谢你的申请，我们决定推进其他候选人', '被裁员了，请交还工牌', 'HR：我们保持联系', '简历已进入人才库（垃圾桶）'];
export const bannerLine = (won: boolean) => pick(won ? WIN : LOSE);

const HURT = ['我的腰!', '打人不打脸!', '疼疼疼', '破防了', '急了急了', '绷不住了', '救命啊', '妈妈我想回家', '这合理吗', '我真的会谢', '你礼貌吗', '有被冒犯到', '一整个大无语', '我不玩了!'];
/** a yelp from someone who just took a big hit (null most of the time) */
export const hurtLine = () => (Math.random() < 0.35 ? pick(HURT) : null);
