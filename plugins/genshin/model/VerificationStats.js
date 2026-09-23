import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('./data/verification')
const file = path.join(dir, 'stats.json')

function cleanQQ(qq) {
  if (qq === undefined || qq === null || qq === '') return ''
  return String(qq).trim()
}

function cleanGroupId(groupId) {
  if (groupId === undefined || groupId === null || groupId === '') return ''
  return String(groupId).trim()
}

function cleanNickname(nickname) {
  if (!nickname) return ''
  return String(nickname).replace(/[\r\n]/g, ' ').trim().slice(0, 40)
}

function cleanGroupName(name) {
  if (!name) return ''
  return String(name).replace(/[\r\n]/g, ' ').trim().slice(0, 60)
}

function normalizeUser(data = {}) {
  return {
    triggered: Number.isFinite(Number(data.triggered)) ? Math.max(0, Math.trunc(Number(data.triggered))) : 0,
    passed: Number.isFinite(Number(data.passed)) ? Math.max(0, Math.trunc(Number(data.passed))) : 0,
    nickname: cleanNickname(data.nickname)
  }
}

function normalizeGroup(data = {}) {
  return {
    triggered: Number.isFinite(Number(data.triggered)) ? Math.max(0, Math.trunc(Number(data.triggered))) : 0,
    passed: Number.isFinite(Number(data.passed)) ? Math.max(0, Math.trunc(Number(data.passed))) : 0,
    name: cleanGroupName(data.name)
  }
}

function normalize(data = {}) {
  const users = {}
  if (data.users && typeof data.users === 'object') {
    for (const [qq, value] of Object.entries(data.users)) {
      const key = cleanQQ(qq)
      if (key) users[key] = normalizeUser(value)
    }
  }

  const groups = {}
  if (data.groups && typeof data.groups === 'object') {
    for (const [groupId, value] of Object.entries(data.groups)) {
      const key = cleanGroupId(groupId)
      if (key) groups[key] = normalizeGroup(value)
    }
  }

  return {
    triggered: Number.isFinite(Number(data.triggered)) ? Math.max(0, Math.trunc(Number(data.triggered))) : 0,
    passed: Number.isFinite(Number(data.passed)) ? Math.max(0, Math.trunc(Number(data.passed))) : 0,
    users,
    groups
  }
}

function ensureDir() {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function read() {
  ensureDir()
  if (!fs.existsSync(file)) {
    const data = normalize()
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
    return data
  }

  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (error) {
    logger.error(`[genshin][verification] 读取统计文件失败: ${error}`)
    return normalize()
  }
}

function write(data) {
  ensureDir()
  const normalized = normalize(data)
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

function nicknameFromEvent(e, qq) {
  if (!e || cleanQQ(e.user_id) !== cleanQQ(qq)) return ''
  return cleanNickname(e?.sender?.nickname || e?.nickname || '')
}

function nicknameFromBot(qq, e) {
  const userId = Number(qq) || qq
  try {
    if (typeof Bot === 'undefined') return ''

    if (Array.isArray(Bot.uin)) {
      for (const botId of Bot.uin) {
        const friend = Bot[botId]?.pickFriend?.(userId)
        const name = cleanNickname(friend?.nickname)
        if (name) return name
      }
    } else {
      const friend = Bot.pickFriend?.(userId)
      const name = cleanNickname(friend?.nickname)
      if (name) return name
    }
  } catch (error) {
    logger.debug?.(`[genshin][verification] 获取QQ昵称失败: ${error}`)
  }
  return ''
}

function groupNameFromEvent(e, groupId) {
  if (!e || cleanGroupId(e.group_id) !== cleanGroupId(groupId)) return ''
  return cleanGroupName(e?.group_name || e?.group?.name || e?.group?.group_name || '')
}

function groupNameFromBot(groupId, e) {
  const id = Number(groupId) || groupId
  try {
    if (typeof Bot === 'undefined') return ''
    let group
    if (Array.isArray(Bot.uin)) {
      const bot = Bot[e?.self_id] || Bot[String(e?.self_id)]
      group = bot?.pickGroup?.(id)
      if (!group) {
        for (const botId of Bot.uin) {
          group = Bot[botId]?.pickGroup?.(id)
          if (group) break
        }
      }
    } else {
      group = Bot.pickGroup?.(id)
    }
    return cleanGroupName(group?.name || group?.group_name || group?.info?.group_name || group?.info?.name)
  } catch (error) {
    logger.debug?.(`[genshin][verification] 获取群名称失败: ${error}`)
    return ''
  }
}

function context(e, fallbackQQ = '') {
  const qq = cleanQQ(e?.user_id || fallbackQQ)
  const nickname = qq ? (nicknameFromEvent(e, qq) || nicknameFromBot(qq, e)) : ''

  // 只有真实的群聊事件才带群信息。自动任务传入 null，因此不会进入群统计。
  const groupId = cleanGroupId(e?.group_id)
  const groupName = groupId ? (groupNameFromEvent(e, groupId) || groupNameFromBot(groupId, e)) : ''

  return { qq, nickname, groupId, groupName }
}

function increment(field, meta = {}) {
  const data = read()
  data[field] += 1

  const qq = cleanQQ(meta.qq)
  if (qq) {
    if (!data.users[qq]) data.users[qq] = normalizeUser()
    data.users[qq][field] += 1
    const nickname = cleanNickname(meta.nickname)
    if (nickname) data.users[qq].nickname = nickname
  }

  const groupId = cleanGroupId(meta.groupId)
  if (groupId) {
    if (!data.groups[groupId]) data.groups[groupId] = normalizeGroup()
    data.groups[groupId][field] += 1
    const groupName = cleanGroupName(meta.groupName)
    if (groupName) data.groups[groupId].name = groupName
  }

  return write(data)
}

export default {
  addTriggered(meta = {}) {
    return increment('triggered', meta)
  },

  addPassed(meta = {}) {
    return increment('passed', meta)
  },

  getStats() {
    return read()
  },

  context,

  resolveNickname(qq, e) {
    return nicknameFromEvent(e, qq) || nicknameFromBot(qq, e)
  },

  resolveGroupName(groupId, e) {
    return groupNameFromEvent(e, groupId) || groupNameFromBot(groupId, e)
  },

  file
}
