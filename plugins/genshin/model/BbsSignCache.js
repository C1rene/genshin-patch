import fs from 'fs'
import path from 'path'
import moment from 'moment'

const cacheDir = path.resolve('./data/sign')
const cacheFile = path.join(cacheDir, 'bbs-sign-status.json')

function today() {
    return moment().format('YYYY-MM-DD')
}

function normalize(value) {
    return String(value ?? '').trim()
}

function normalizeLikes(value) {
    let num = Number(value)
    if (!Number.isFinite(num) || num < 0) return 0
    return Math.min(10, Math.floor(num))
}

function normalizeForum(value) {
    // 兼容旧缓存：原先论坛状态直接保存为 true/false。
    if (typeof value === 'boolean')
        return { signed: value, likes: 0 }

    if (!value || typeof value !== 'object' || Array.isArray(value))
        return { likes: 0 }

    let result = { likes: normalizeLikes(value.likes) }
    if (typeof value.signed === 'boolean') result.signed = value.signed
    return result
}

function normalizeForums(forums) {
    let result = {}
    if (!forums || typeof forums !== 'object' || Array.isArray(forums)) return result
    for (let [key, value] of Object.entries(forums))
        result[normalize(key)] = normalizeForum(value)
    return result
}

function readAll() {
    try {
        if (!fs.existsSync(cacheFile)) return {}
        let data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    } catch (error) {
        logger.error(`[米币签到缓存]读取失败：${error}`)
        return {}
    }
}

function writeAll(data) {
    try {
        fs.mkdirSync(cacheDir, { recursive: true })
        fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8')
        return true
    } catch (error) {
        logger.error(`[米币签到缓存]写入失败：${error}`)
        return false
    }
}

function getRecord(qq, mysUid) {
    qq = normalize(qq)
    mysUid = normalize(mysUid)
    if (!qq || !mysUid) return null

    let data = readAll()
    let record = data?.[qq]?.[mysUid]
    if (!record || record.date !== today()) return null

    return {
        date: record.date,
        ...(typeof record.coinSigned === 'boolean' ? { coinSigned: record.coinSigned } : {}),
        forums: normalizeForums(record.forums)
    }
}

function updateRecord(qq, mysUid, patch = {}) {
    qq = normalize(qq)
    mysUid = normalize(mysUid)
    if (!qq || !mysUid) return null

    let data = readAll()
    let old = data?.[qq]?.[mysUid]
    if (!old || old.date !== today()) old = { date: today(), forums: {} }

    let next = {
        date: today(),
        ...(typeof old.coinSigned === 'boolean' ? { coinSigned: old.coinSigned } : {}),
        forums: normalizeForums(old.forums)
    }

    if (typeof patch.coinSigned === 'boolean')
        next.coinSigned = patch.coinSigned

    if (patch.forums && typeof patch.forums === 'object' && !Array.isArray(patch.forums)) {
        for (let [forumKey, forumPatch] of Object.entries(patch.forums)) {
            forumKey = normalize(forumKey)
            if (!forumKey) continue

            let oldForum = normalizeForum(next.forums[forumKey])
            if (typeof forumPatch === 'boolean') {
                next.forums[forumKey] = { ...oldForum, signed: forumPatch }
                continue
            }

            if (forumPatch && typeof forumPatch === 'object') {
                let merged = { ...oldForum }
                if (typeof forumPatch.signed === 'boolean') merged.signed = forumPatch.signed
                if (forumPatch.likes !== undefined) merged.likes = normalizeLikes(forumPatch.likes)
                next.forums[forumKey] = merged
            }
        }
    }

    if (!data[qq] || typeof data[qq] !== 'object' || Array.isArray(data[qq]))
        data[qq] = {}

    // 每次只覆写当前QQ下当前米游社UID的当日记录，不累计历史日期。
    data[qq][mysUid] = next
    writeAll(data)
    return next
}

function getCoinStatus(qq, mysUid) {
    let record = getRecord(qq, mysUid)
    if (!record) return null
    if (record.coinSigned === true) return true
    if (record.coinSigned === false) return false

    if (Object.values(record.forums || {}).some(item => normalizeForum(item).signed === true))
        return true

    return null
}

function setCoinStatus(qq, mysUid, status) {
    return updateRecord(qq, mysUid, { coinSigned: !!status })
}

function getForumInfo(qq, mysUid, forumId) {
    let record = getRecord(qq, mysUid)
    if (!record) return null
    let key = normalize(forumId)
    if (!key || record.forums?.[key] === undefined) return null
    return normalizeForum(record.forums[key])
}

function getForumStatus(qq, mysUid, forumId) {
    let info = getForumInfo(qq, mysUid, forumId)
    return typeof info?.signed === 'boolean' ? info.signed : null
}

function setForumStatus(qq, mysUid, forumId, status) {
    let forumKey = normalize(forumId)
    if (!forumKey) return null

    let patch = {
        forums: {
            [forumKey]: { signed: !!status }
        }
    }

    // 任意社区确认已签到，即可确认当天米币签到已经完成。
    if (status === true) patch.coinSigned = true
    return updateRecord(qq, mysUid, patch)
}

function getForumLikes(qq, mysUid, forumId) {
    let info = getForumInfo(qq, mysUid, forumId)
    return normalizeLikes(info?.likes)
}

function setForumLikes(qq, mysUid, forumId, likes) {
    let forumKey = normalize(forumId)
    if (!forumKey) return null
    return updateRecord(qq, mysUid, {
        forums: {
            [forumKey]: { likes: normalizeLikes(likes) }
        }
    })
}

function addForumLike(qq, mysUid, forumId, count = 1) {
    let current = getForumLikes(qq, mysUid, forumId)
    let next = normalizeLikes(current + Number(count || 0))
    setForumLikes(qq, mysUid, forumId, next)
    return next
}

function isForumComplete(qq, mysUid, forumId) {
    return getForumStatus(qq, mysUid, forumId) === true &&
        getForumLikes(qq, mysUid, forumId) >= 10
}

function isAllForumsComplete(qq, mysUid, forumData = []) {
    if (!Array.isArray(forumData) || forumData.length === 0) return false
    return forumData.every(forum => {
        let forumId = forum?.signId ?? forum?.id
        return isForumComplete(qq, mysUid, forumId)
    })
}

export default {
    file: cacheFile,
    getRecord,
    updateRecord,
    getCoinStatus,
    setCoinStatus,
    getForumInfo,
    getForumStatus,
    setForumStatus,
    getForumLikes,
    setForumLikes,
    addForumLike,
    isForumComplete,
    isAllForumsComplete
}
