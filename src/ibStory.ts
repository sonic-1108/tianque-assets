import { getIb, ibTask, ibDelayDeadline, type Task } from './banker';
export type Choice = { label: string; reply: string; correct?: boolean; trust?: number };
export type Scene = { npc: string; role: string; title: string; text: string; evidence: string; choices: Choice[] };
export function sceneFor(t: Task, step: number, index = 0): Scene {
  const quiz = (npc: string, role: string, title: string, text: string, evidence: string, answers: string[], correct: number, reply: string): Scene => ({npc,role,title,text,evidence,choices:answers.map((label,i)=>({label,correct:i===correct,reply:i===correct?reply:'再看看手里的资料。这项结论没有得到证据支持，我们不能这样交出去。'}))});
  if (t.kind === 'work') return quiz('林砚','项目经理','深夜的第三版模型','你发现模型把收入当成了利润。客户明早要看，请先纠正摘要。','本季度收入 1,200 万；运营成本 900 万；不计其他项目。利润率 =（收入 − 成本）÷ 收入。',['利润率 75%','利润率 25%','利润率 300%'],1,'对，利润是 300 万。修订版已经归档，接下来我会亲自核对你的材料。');
  if (t.kind === 'trade') return quiz('周衡','交易主管','先说清风险','赚钱之前，告诉我：如果价格没有按预想上涨，你准备怎么办？','任务仍需实际完成一笔达到目标收益的交易。浮动价格没有保证收益；卖出会结算盈利或亏损。',['保证一定上涨，再加仓','承认可能亏损，观察价格后自行决定卖出','把浮盈直接当作任务完成'],1,'可以。交易台交给你。先买入，再观察墙上行情；只有实际卖出并达到目标才算完成。');
  if (step === 0) return {npc:'苏晴',role:'项目协调员',title:'第一天，不只是领工牌',text:'湖边的客户陈先生正在考虑出售公司，但他最担心的不是价格。林砚留下的资料有一处错误，你愿意怎么开始？',evidence:'今日委托：核对资料 → 了解客户 → 修订模型 → 交易考核 → 董事会谈判。',choices:[{label:'先核对资料，再去听客户的顾虑',reply:'好。我把核对清单给你，去 80 层找林砚。记住：先听清楚，再作承诺。',trust:1},{label:'先接下任务，到了现场再判断',reply:'工牌给你。林砚在 80 层打印机旁等着，别把未经核对的数字带给客户。'}]};
  if (t.verb.includes('deck') || t.verb.includes('pitchbook')) {
    if (!t.client) return quiz('林砚','项目经理','缺失的那一页','打印稿把增长率写错了。选出正确的数字，我再把核对过的版本交给你。','去年收入 800 万，今年收入 1,000 万。增长率 = 增量 ÷ 去年收入。',['增长 20%','增长 25%','增长 125%'],1,'正确。错误页已经替换，你拿到的是核验版。见客户时，请先问他的目标。');
  }
  if (t.client) return {npc:'陈启明',role:'企业创始人',title:'湖城来客的条件',text:'我不是只想卖个高价。团队跟了我十年，我希望收购后还能保住核心团队。你会怎么写提案？',evidence:'客户诉求：保留核心团队；分阶段付款；不接受未经核实的收益承诺。',choices:[{label:'把团队保留条款写入协议，再谈估值',reply:'这才是我愿意继续谈的原因。请把人员条款带进董事会，我会支持你的方案。',trust:2},{label:'先推动估值谈判，同时记录人员诉求',reply:'可以继续谈，但最终协议必须回应人员问题。我会在签字前再问你一次。',trust:1},{label:'承诺最高价格，其他以后再说',reply:'空口的最高价对我没有帮助。请带一份能兑现的协议来。',trust:-1}]};
  if (t.verb.includes('路演')) {
    const rounds = [
      ['现金从哪里来？','收入 1,000 万，现金回款 600 万，其余为应收账款。',['把收入都说成现金','说明回款和应收的区别','不回答现金问题'],1,'回答清楚了。我们愿意进入下一轮沟通。'],
      ['增长是否可靠？','最大客户贡献收入的 60%，尚未签下一年合同。',['承认集中风险并说明续约计划','保证明年翻倍','隐去大客户占比'],0,'风险解释充分，我们会继续审议。'],
      ['募集的钱用在哪里？','计划：研发 50%，设备 30%，运营储备 20%。',['全部发奖金','明确用途并提供跟踪报告','只强调股价上涨'],1,'资金用途明确。路演材料通过核对。'],
    ] as const;
    const r=rounds[index%3];
    return quiz(['许岚','赵川','唐宁'][index%3],'机构投资人','路演现场问答',r[0],r[1],[...r[2]],r[3],r[4]);
  }
  return quiz('顾远','董事会代表','签字之前','陈先生把核心团队交给我们。最后的协议应该采用哪一版？','会谈记录：保留核心团队、分阶段付款；未经核实的高收益不应写成保证。',['只写最高估值，删掉人员条款','保留团队条款，写明分期付款条件','保证所有投资人都能获利'],1,'条款与客户要求一致。双方签字，项目正式完成。');
}
const listeners = new Set<()=>void>();
let dialog: {scene:Scene; reply:string|null; choice:Choice|null; done:()=>void; key:string; started:number}|null=null;
export const storySubscribe=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}};
export const storySnapshot=()=>dialog;
const emit=()=>listeners.forEach(f=>f());
export const taskKey=()=>{const s=getIb();return `${s.step}:${s.deals}:${s.deal?.name??''}:${s.deal?.i??0}`};
let briefed='';
export const tradeBriefed=()=>briefed===taskKey();
export function openStory(done:()=>void) {
  const t=ibTask(); if(!t||dialog)return;
  dialog={scene:sceneFor(t,getIb().step,getIb().deal?.i),reply:null,choice:null,done,key:taskKey(),started:Date.now()};
  document.exitPointerLock?.(); emit();
}
export function chooseStory(i:number) {if(!dialog||dialog.reply)return;const c=dialog.scene.choices[i];if(!c)return;dialog={...dialog,reply:c.reply,choice:c};emit()}
export function retryStory(){if(dialog){dialog={...dialog,reply:null,choice:null};emit()}}
export function closeStory(complete=false) {
  const d=dialog;if(!d)return;
  if(complete&&(!d.choice||d.choice.correct===false))return;
  const s=getIb(); if(s.deal?.deadline&&d.key===taskKey())ibDelayDeadline(Date.now()-d.started);
  dialog=null;emit();
  if(complete&&d.key===taskKey()){
    const t=ibTask();if(t?.kind==='trade')briefed=d.key;
    try {const old=JSON.parse(localStorage.getItem('tq_ib_story')||'{}');localStorage.setItem('tq_ib_story',JSON.stringify({trust:(Number(old.trust)||0)+(d.choice?.trust??0),last:`${d.scene.npc}：${d.choice?.reply}`}));}catch{}
    d.done();
  }
}
export function storyRecord():{trust:number;last:string} {try{return JSON.parse(localStorage.getItem('tq_ib_story')||'null')||{trust:0,last:''}}catch{return {trust:0,last:''}}}
