const activeQQ = {
  game: new Set(),
  coin: new Set()
}

function key(qq) {
  return String(qq ?? '').trim()
}

function getQueue(type) {
  return activeQQ[type === 'coin' ? 'coin' : 'game']
}

export function isBusy(qq, type = 'game') {
  qq = key(qq)
  return qq ? getQueue(type).has(qq) : false
}

export function tryAcquire(qq, type = 'game') {
  qq = key(qq)
  let queue = getQueue(type)
  if (!qq || queue.has(qq)) return false
  queue.add(qq)
  return true
}

export function release(qq, type = 'game') {
  qq = key(qq)
  if (qq) getQueue(type).delete(qq)
}

export function releaseMany(qqs, type = 'game') {
  for (let qq of qqs || []) release(qq, type)
}

export default {
  isBusy,
  tryAcquire,
  release,
  releaseMany
}
