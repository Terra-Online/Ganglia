const sub = (a,b) => a.map((v,i) => v-b[i]);
const dot = (a,b) => a.reduce((v,x,i) => v+x*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const mix = (a,b,t) => a.map((v,i) => v+(b[i]-v)*t);
const squared = (a,b) => dot(sub(a,b),sub(a,b));
const pointSegment = (p,a,b) => {
  const d=sub(b,a), length=dot(d,d);
  return squared(p,mix(a,b,length ? Math.max(0,Math.min(1,dot(sub(p,a),d)/length)) : 0));
};
const segmentSegment = (a,b,c,d) => {
  let best=Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
  const u=sub(b,a),v=sub(d,c),w=sub(c,a),n=cross(u,v),denom=dot(n,n);
  if(denom>0){
    const s=dot(cross(w,v),n)/denom,t=dot(cross(w,u),n)/denom;
    if(s>=0&&s<=1&&t>=0&&t<=1)best=Math.min(best,squared(mix(a,b,s),mix(c,d,t)));
  }
  return best;
};
const inside = (p,triangle,n) => triangle.every((a,i) =>
  dot(cross(sub(triangle[(i+1)%3],a),sub(p,a)),n)>=0);
const pointTriangle = (p,triangle,n) => {
  const area=dot(n,n);
  if(area>0){
    const distance=dot(sub(p,triangle[0]),n)/area;
    const projected=p.map((v,i)=>v-n[i]*distance);
    if(inside(projected,triangle,n))return squared(p,projected);
  }
  return Math.min(...triangle.map((a,i)=>pointSegment(p,a,triangle[(i+1)%3])));
};
const segmentTriangle = (a,b,triangle) => {
  const n=cross(sub(triangle[1],triangle[0]),sub(triangle[2],triangle[0]));
  const da=dot(sub(a,triangle[0]),n),db=dot(sub(b,triangle[0]),n);
  if(da!==db){
    const t=da/(da-db);
    if(t>=0&&t<=1&&inside(mix(a,b,t),triangle,n))return 0;
  }
  return Math.min(pointTriangle(a,triangle,n),pointTriangle(b,triangle,n),
    ...triangle.map((c,i)=>segmentSegment(a,b,c,triangle[(i+1)%3])));
};
const triangleTriangle = (a,b) => Math.min(
  ...a.map((v,i)=>segmentTriangle(v,a[(i+1)%3],b)),
  ...b.map((v,i)=>segmentTriangle(v,b[(i+1)%3],a)));
const overlaps = (a,b) => [0,1,2].every(i=>a[i]<=b[i+3]&&a[i+3]>=b[i]);
const point = p => Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);

/** Index a snapshot of world-space triangle surfaces. No layer, state or coverage
 * inference is performed. Triangles are double-sided thin surfaces, not solid volumes.
 * A capsule contained wholly inside a closed mesh therefore needs a separate initial
 * occupancy check. Callers must start from a verified free standing position.
 */
export function createCollisionWorld(geometry){
  if(!geometry?.positions||!geometry.indices||geometry.positions.length%3||geometry.indices.length%3)
    throw new Error('Invalid collision geometry');
  for(const v of geometry.positions)if(!Number.isFinite(v))throw new Error('Non-finite collision vertex');
  for(const i of geometry.indices)if(!Number.isInteger(i)||i<0||i>=geometry.positions.length/3)
    throw new Error('Invalid collision index');
  const positions=Float64Array.from(geometry.positions),indices=Uint32Array.from(geometry.indices);
  const count=indices.length/3,order=Uint32Array.from({length:count},(_,i)=>i),bounds=new Float64Array(count*6);
  const vertex=i=>Array.from(positions.subarray(i*3,i*3+3));
  const triangle=id=>[0,1,2].map(i=>vertex(indices[id*3+i]));
  for(let id=0;id<count;id++){
    const points=triangle(id);
    for(let i=0;i<3;i++){
      bounds[id*6+i]=Math.min(...points.map(p=>p[i]));
      bounds[id*6+i+3]=Math.max(...points.map(p=>p[i]));
    }
  }
  const build=(start,end)=>{
    const box=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for(let j=start;j<end;j++)for(let i=0;i<3;i++){
      box[i]=Math.min(box[i],bounds[order[j]*6+i]);box[i+3]=Math.max(box[i+3],bounds[order[j]*6+i+3]);
    }
    if(end-start<=8)return {box,start,end};
    let axis=0;for(let i=1;i<3;i++)if(box[i+3]-box[i]>box[axis+3]-box[axis])axis=i;
    order.subarray(start,end).sort((a,b)=>(bounds[a*6+axis]+bounds[a*6+axis+3])-(bounds[b*6+axis]+bounds[b*6+axis+3])||a-b);
    const middle=(start+end)>>>1;
    return {box,left:build(start,middle),right:build(middle,end)};
  };
  const root=count?build(0,count):null;
  return {
    /** Find upward support at exactly the supplied XZ position. Slope is in degrees.
     * Height limits are explicit and independent. This establishes triangle support
     * only; callers still verify standing capsule clearance and active world coverage.
     */
    groundAt(position,options){
      const {maxUp,maxDown,maxSlope}=options??{};
      if(!point(position)||![maxUp,maxDown,maxSlope].every(Number.isFinite)||
          maxUp<0||maxDown<0||maxSlope<=0||maxSlope>=90)throw new Error('Invalid ground support query');
      const box=[position[0],position[1]-maxDown,position[2],position[0],position[1]+maxUp,position[2]];
      if(!box.every(Number.isFinite))throw new Error('Non-finite ground support bounds');
      const minimumUp=Math.cos(maxSlope*Math.PI/180),stack=root?[root]:[];
      let best=null,bestOffset=Infinity;
      while(stack.length){
        const node=stack.pop();
        if(!overlaps(box,node.box))continue;
        if(node.left){stack.push(node.left,node.right);continue;}
        for(let index=node.start;index<node.end;index++){
          const id=order[index];
          if(!overlaps(box,bounds.subarray(id*6,id*6+6)))continue;
          const face=triangle(id),ab=sub(face[1],face[0]),ac=sub(face[2],face[0]);
          const normal=cross(ab,ac),length=Math.hypot(...normal);
          if(!Number.isFinite(length))throw new Error('Non-finite ground support normal');
          if(length===0||normal[1]<=0||normal[1]/length<minimumUp)continue;
          const x=position[0]-face[0][0],z=position[2]-face[0][2],determinant=-normal[1];
          const u=(x*ac[2]-z*ac[0])/determinant,v=(ab[0]*z-ab[2]*x)/determinant;
          // Only a numerical barycentric tolerance is allowed; the query never
          // searches neighbouring XZ positions or snaps across a missing floor.
          if(u < -1e-10||v < -1e-10||u+v > 1+1e-10)continue;
          const height=face[0][1]+u*ab[1]+v*ac[1];
          if(!Number.isFinite(height))throw new Error('Non-finite ground support height');
          if(height<box[1]||height>box[4])continue;
          const offset=Math.abs(height-position[1]);
          if(offset<bestOffset||(offset===bestOffset&&height>best.position[1])){
            bestOffset=offset;
            best={position:[position[0],height,position[2]],triangle:id,normal:normal.map(value=>value/length)};
          }
        }
      }
      return best;
    },
    /** Continuous straight translation of an upright capsule, given feet positions.
     * Its axis sweeps a parallelogram; distance to that entire surface, not discrete
     * positions along the path, decides collision. Inflation bounds interpolation
     * error for curved paths and enlarges the capsule in every direction.
     * Returns any touching triangle, NOT the earliest impact or a landing proof.
     */
    sweepCapsule(start,end,profile){
      const {radius,height,inflation=0}=profile??{};
      if(!point(start)||!point(end)||![radius,height,inflation].every(Number.isFinite)||
          radius<0||height<=0||height<2*radius||inflation<0)throw new Error('Invalid capsule sweep');
      const r=radius+inflation;
      const box=[Math.min(start[0],end[0])-r,Math.min(start[1],end[1])-inflation,Math.min(start[2],end[2])-r,
        Math.max(start[0],end[0])+r,Math.max(start[1],end[1])+height+inflation,Math.max(start[2],end[2])+r];
      if(!box.every(Number.isFinite))throw new Error('Non-finite capsule bounds');
      const a=[start[0],start[1]+radius,start[2]],b=[start[0],start[1]+height-radius,start[2]];
      const c=[end[0],end[1]+radius,end[2]],d=[end[0],end[1]+height-radius,end[2]];
      const stack=root?[root]:[];
      while(stack.length){
        const node=stack.pop();if(!overlaps(box,node.box))continue;
        if(node.left){stack.push(node.left,node.right);continue;}
        for(let i=node.start;i<node.end;i++){
          const id=order[i];if(!overlaps(box,bounds.subarray(id*6,id*6+6)))continue;
          const face=triangle(id),distance=Math.min(triangleTriangle([a,b,d],face),triangleTriangle([a,d,c],face));
          if(!Number.isFinite(distance))throw new Error('Non-finite collision distance');
          if(distance<=r*r)return {triangle:id,distance:Math.sqrt(distance)};
        }
      }
      return null;
    },
  };
}
