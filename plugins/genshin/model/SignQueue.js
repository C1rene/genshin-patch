const activeQQ = new Set()

function key(qq) {
  return String(qq ?? '').trim()
}

export function isBusy(qq) {
  qq = key(qq)
  return qq ? activeQQ.has(qq) : false
}

export function tryAcquire(qq) {
  qq = key(qq)
  if (!qq || activeQQ.has(qq)) return false
  activeQQ.add(qq)
  return true
}

export function release(qq) {
  qq = key(qq)
  if (qq) activeQQ.delete(qq)
}

export function releaseMany(qqs) {
  for (let qq of qqs || []) release(qq)
}

export default {
  isBusy,
  tryAcquire,
  release,
  releaseMany
}
