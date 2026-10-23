/** Flight is a deliberate recovery/reposition action, before offensive skill selection. */
export function shouldTraderTakeoff({grounded,glide=0,cooldown=0,mp,hp,maxHp,distance,threat=false}) {
  if(!grounded||glide>0||cooldown>0||mp<20||hp<=0||maxHp<=0)return false;
  // only to get out of trouble: low on health with someone close, or cornered (no more flying about to heal up)
  return (hp/maxHp<=.4 && distance<10) || (threat && distance<4.5 && hp/maxHp<=.6);
}
/** Keep separation while healing, orbit at medium range, close distant gaps. */
export function traderFlightDirection(dx,dz,strafe=1) {
  const d=Math.hypot(dx,dz), x=d>.01?dx/d:0,z=d>.01?dz/d:-1;
  const toward=d<7?-.8:d>14?.85:0;
  const side=strafe<0?-1:1;
  const mx=x*toward-z*side*.7,mz=z*toward+x*side*.7,l=Math.hypot(mx,mz)||1;
  return [mx/l,mz/l];
}
