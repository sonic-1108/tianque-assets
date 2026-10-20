import React,{useSyncExternalStore} from 'react';
import {Html} from '@react-three/drei';
import {career} from '../career';
export function CareerBeacon(){const s=useSyncExternalStore(career.subscribe,career.getSnapshot),r=s.run;if(!r?.origin||r.failed)return null;return <group position={r.origin}><mesh rotation={[-Math.PI/2,0,0]} position={[0,.08,0]}><ringGeometry args={[2.8,3,64]}/><meshBasicMaterial color={r.ready?'#a8f3c6':'#dec086'} transparent opacity={.75} depthWrite={false}/></mesh><Html center position={[0,2.5,0]} style={{pointerEvents:'none',whiteSpace:'nowrap',padding:'5px 10px',background:'#11252cdd',color:'#ebd39c',border:'1px solid #bc9c65',fontSize:12}}>返程交付点 {r.ready?'· F 交付':''}</Html></group>}
