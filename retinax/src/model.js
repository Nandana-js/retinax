/**
 * THE ONLY FILE YOU CHANGE WHEN THE AI MODEL ARRIVES.
 *
 * Contract: predict(buffer, filename) -> { grade: 0..4, confidence: 0..1, heatmap?: "data:image/png;base64,..." }
 *   grade: 0 No DR, 1 Mild, 2 Moderate, 3 Severe, 4 Proliferative
 *   heatmap: optional Grad-CAM overlay; if absent, the UI draws an illustrative one.
 *
 * MODEL_MODE=mock -> fake results (file name containing nodr/mild/moderate/severe/prolif forces that grade)
 * MODEL_MODE=http -> POST multipart field "file" to MODEL_URL. Adjust the mapping in http() to the model team's response.
 */
const mock = async (buf, name = '') => {
  await new Promise(r => setTimeout(r, 500));
  let seed = buf.length + name.length * 31;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const hint = name.toLowerCase().match(/nodr|mild|moderate|severe|prolif/);
  const grade = hint ? ['nodr', 'mild', 'moderate', 'severe', 'prolif'].indexOf(hint[0]) : Math.floor(rnd() * 5);
  return { grade, confidence: +(0.55 + rnd() * 0.43).toFixed(2), seed: buf.length };
};

const http = async (buf, name = 'eye.jpg') => {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  const res = await fetch(process.env.MODEL_URL, {
    method: 'POST', body: fd,
    headers: process.env.MODEL_API_KEY ? { Authorization: `Bearer ${process.env.MODEL_API_KEY}` } : {},
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Model service returned ${res.status}`);
  const j = await res.json();
  // >>> ADAPT these field names to the model team's actual response <<<
  return { grade: j.grade, confidence: j.confidence, heatmap: j.gradcam };
};

export async function predict(buf, name) {
  const out = await (process.env.MODEL_MODE === 'http' ? http : mock)(buf, name);
  if (!Number.isInteger(out.grade) || out.grade < 0 || out.grade > 4 || !(out.confidence >= 0 && out.confidence <= 1))
    throw new Error('Model returned an invalid result');
  return out;
}
