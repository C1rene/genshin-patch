import fs from 'node:fs'
import yaml from 'yaml'
import cfg from '../../../lib/config/config.js'

const root = process.cwd().replace(/\\/g, '/')
const configDir = `${root}/plugins/genshin/config`

function readYaml(name) {
  try {
    return yaml.parse(fs.readFileSync(`${configDir}/${name}.yaml`, 'utf8')) || {}
  } catch {
    return {}
  }
}

function asList(value) {
  return Array.isArray(value) ? value : []
}

function norm(value) {
  return String(value ?? '').trim()
}

function uniq(values) {
  return [...new Set((values || []).map(norm).filter(Boolean))]
}

function isMasterQQ(qq) {
  qq = norm(qq)
  return asList(cfg.masterQQ).some(id => norm(id) === qq)
}

function splitGroupRef(ref) {
  ref = norm(ref)
  if (!ref) return {}
  let idx = ref.indexOf(':')
  if (idx === -1) return { botId: '', groupId: ref }
  return { botId: ref.slice(0, idx), groupId: ref.slice(idx + 1) }
}

function pickGroup(ref) {
  let { botId, groupId } = splitGroupRef(ref)
  if (!groupId) return null
  groupId = Number(groupId) || groupId
  try {
    if (Array.isArray(Bot.uin)) {
      if (botId) {
        let bot = Bot[botId] || Bot[Number(botId)]
        return bot?.pickGroup?.(groupId) || null
      }
      for (let id of Bot.uin) {
        let group = Bot[id]?.pickGroup?.(groupId)
        if (group) return group
      }
      return null
    }
    return Bot.pickGroup?.(groupId) || null
  } catch {
    return null
  }
}

async function getGroupMembers(ref) {
  let group = pickGroup(ref)
  if (!group) return []

  try {
    let data
    if (typeof group.getMemberMap === 'function') data = await group.getMemberMap()
    else if (group.memberMap) data = group.memberMap
    else if (typeof group.getMemberList === 'function') data = await group.getMemberList()

    if (data instanceof Map) return uniq([...data.keys()])
    if (Array.isArray(data))
      return uniq(data.map(item => item?.user_id ?? item?.userId ?? item?.qq ?? item?.id))
    if (data && typeof data === 'object') return uniq(Object.keys(data))
  } catch (error) {
    logger.error(`[签到权限]获取群成员失败 ${ref}: ${error}`)
  }
  return []
}

async function isMember(ref, qq) {
  qq = norm(qq)
  if (!qq) return false

  // pickMember() 在部分适配器中只是创建一个成员对象，即使该 QQ 实际不在群里
  // 也会带 user_id，不能据此判断成员关系。必须以真实群成员表为准。
  let members = await getGroupMembers(ref)
  return members.includes(qq)
}

function getAllGroupRefs() {
  try {
    let values = Bot.gl instanceof Map ? [...Bot.gl.values()] : Object.values(Bot.gl || {})
    return uniq(values.map(item => {
      let botId = item?.bot_id ?? item?.self_id ?? (Array.isArray(Bot.uin) ? Bot.uin[0] : Bot.uin)
      let groupId = item?.group_id ?? item?.groupId ?? item?.id
      return groupId ? `${botId ?? ''}:${groupId}` : ''
    }))
  } catch {
    return []
  }
}

async function membersOfGroups(refs, allWhenEmpty = false) {
  refs = uniq(refs)
  if (refs.length === 0 && allWhenEmpty) refs = getAllGroupRefs()

  let result = []
  for (let ref of refs)
    result.push(...await getGroupMembers(ref))
  return uniq(result)
}

async function belongsToAny(qq, refs) {
  for (let ref of uniq(refs))
    if (await isMember(ref, qq)) return true
  return false
}

function getWhite() {
  let white = readYaml('white')
  return {
    ...white,
    QQ: asList(white.QQ),
    bbsQQ: asList(white.bbsQQ),
    gameGroup: asList(white.gameGroup),
    bbsGroup: asList(white.bbsGroup),
    signPush: asList(white.signPush),
    bbsPush: asList(white.bbsPush)
  }
}

export async function getPermission(qq) {
  qq = norm(qq)
  if (isMasterQQ(qq)) return 'master'

  let white = getWhite()
  let gameQQ = white.QQ.map(norm)
  let coinQQ = white.bbsQQ.map(norm)

  if (coinQQ.includes(qq)) return 'coin'
  if (gameQQ.includes(qq)) return 'game'

  let M = white.bbsGroup
  let G = white.gameGroup

  // 两种群白名单都为空时，普通手动签到全部开放。
  if (M.length === 0 && G.length === 0) return 'coin'

  if (M.length > 0 && await belongsToAny(qq, M)) return 'coin'

  // 游戏白名单为空 = 游戏签到对所有人开放。
  if (G.length === 0) return 'game'
  if (await belongsToAny(qq, G)) return 'game'

  return 'none'
}

export function hasLevel(permission, level) {
  let rank = { none: 0, game: 1, coin: 2, master: 3 }
  return (rank[permission] || 0) >= (rank[level] || 0)
}

function cronTime(cron) {
  let parts = norm(cron).split(/\s+/)
  if (parts.length < 3) return null
  let values = parts.slice(0, 3).map(part => /^\d+$/.test(part) ? Number(part) : NaN)
  if (values.some(Number.isNaN)) return null
  let [sec, min, hour] = values
  if (sec > 59 || min > 59 || hour > 23) return null
  return { hour, min, sec }
}

export function isBeforeManualTime(level) {
  let config = readYaml('config')
  let time = cronTime(level === 'coin' ? config.bbsSignTime : config.signTime)
  if (!time) return false

  let now = new Date()
  let nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  let startSeconds = time.hour * 3600 + time.min * 60 + time.sec
  return nowSeconds < startSeconds
}

export async function getMasterTargets(e, level) {
  if (e?.group_id) {
    let ref = `${e.self_id ?? ''}:${e.group_id}`
    return await membersOfGroups([ref], false)
  }

  let white = getWhite()
  let refs = level === 'game'
    ? uniq([...white.bbsGroup, ...white.gameGroup])
    : uniq(white.bbsGroup)

  // 主人私聊批量命令：相关群白名单为空时作用于所有群。
  return await membersOfGroups(refs, true)
}

export async function getAutoQQs(level) {
  let config = readYaml('config')
  let white = getWhite()
  let gameQQ = uniq([...white.QQ, ...white.bbsQQ])
  let coinQQ = uniq(white.bbsQQ)

  // 关闭“自动签到群和QQ白名单”后，仅使用QQ白名单；
  // 对应QQ白名单为空时保持无白名单的“全部账号”行为。
  if (!config.whiteGroup) {
    let list = level === 'coin' ? coinQQ : gameQQ
    return list.length > 0 ? list : null
  }

  let M = white.bbsGroup
  let G = white.gameGroup

  if (level === 'coin') {
    if (M.length === 0) {
      if (G.length === 0) return null
      return coinQQ
    }
    return uniq([...(await membersOfGroups(M)), ...coinQQ])
  }

  // 游戏白名单为空时，游戏签到面向全部账号；
  // 米币白名单中的QQ本身也自动具有游戏权限。
  if (G.length === 0) return null
  return uniq([...(await membersOfGroups([...M, ...G])), ...gameQQ])
}

export function getWhiteConfig() {
  return getWhite()
}

export function isMaster(qq) {
  return isMasterQQ(qq)
}

export default {
  getPermission,
  hasLevel,
  isBeforeManualTime,
  getMasterTargets,
  getAutoQQs,
  getWhiteConfig,
  isMaster,
  getGroupMembers,
  membersOfGroups
}
