/* Clinical rules live on the server so every client gets the same decision. Have a clinician sign these off. */
export const GRADES = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];
const AC = [
  ['rescreen', 'Rescreen in 12 months'],
  ['rescreen', 'Rescreen in 6–12 months'],
  ['refer', 'Refer to an ophthalmologist within 2 weeks'],
  ['urgent', 'Urgent: retina specialist within 48 hours'],
  ['urgent', 'Urgent: retina specialist within 48 hours']
];
export const LOW_CONF = 0.7;

export function decide(eyes) {
  const list = Object.values(eyes);
  const grade = Math.max(...list.map(e => e.grade));
  const low = list.some(e => e.conf < LOW_CONF);
  let [action, actText] = AC[grade];
  if (low && action === 'rescreen') { action = 'refer'; actText = 'Refer for specialist review (low model confidence)'; }
  return { grade, action, actText, low };
}
