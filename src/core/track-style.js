// One visual language for measured GPS, reconstructed roads and unknown gaps.
export const TRACK_STYLE = Object.freeze({
 measured: '#3c7954', road: '#d87619', gap: '#8b8e96',
 weight: 4, dashArray: '7 6',
});
export const SPEED_MAX = 110;
export const SPEED_RAMP = ['#a7f3d0','#4ade80','#16a34a','#15803d','#064e3b'];
export function speedColor(kmh) {
 const t=Math.max(0,Math.min(1,(kmh||0)/SPEED_MAX));
 return SPEED_RAMP[Math.min(SPEED_RAMP.length-1,Math.floor(t*(SPEED_RAMP.length-1)+0.5))];
}
export function trackLineStyle(kind,{speed}={}) {
 return {color:kind==='track'?(speed==null?TRACK_STYLE.measured:speedColor(speed)):kind==='road'?TRACK_STYLE.road:TRACK_STYLE.gap,
  weight:TRACK_STYLE.weight,dashArray:kind==='track'?null:TRACK_STYLE.dashArray,opacity:.95,lineCap:'round'};
}
