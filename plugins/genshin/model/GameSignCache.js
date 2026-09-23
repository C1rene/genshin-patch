import fs from 'fs'
import path from 'path'
import moment from 'moment'

const cacheDir = path.resolve('./data/sign')
const cacheFile = path.join(cacheDir, 'game-sign-status.json')

function today() {
    return moment().format('YYYY-MM-DD')
}

function normalize(value) {
    return String(value ?? '').trim()
}

function readAll() {
    try {
        if (!fs.existsSync(cacheFile)) return {}
        let data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    } catch (error) {
        logger.error(`[游戏签到缓存]读取失败：${error}`)
        return {}
    }
}

function writeAll(data) {
    try {
        fs.mkdirSync(cacheDir, { recursive: true })
        fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8')
        return true
    } catch (error) {
        logger.error(`[游戏签到缓存]写入失败：${error}`)
        return false
    }
}

function getRecord(qq) {
    qq = normalize(qq)
    if (!qq) return null

    let data = readAll()
    let record = data?.[qq]
    if (!record || record.date !== today()) return null

    let games = {}
    if (record.games && typeof record.games === 'object' && !Array.isArray(record.games)) {
        for (let [game, uids] of Object.entries(record.games)) {
            if (!uids || typeof uids !== 'object' || Array.isArray(uids)) continue
            games[normalize(game)] = {}
            for (let [uid, signed] of Object.entries(uids))
                if (typeof signed === 'boolean') games[normalize(game)][normalize(uid)] = signed
        }
    }

    return { date: record.date, games }
}

function setStatus(qq, game, uid, signed) {
    qq = normalize(qq)
    game = normalize(game)
    uid = normalize(uid)
    if (!qq || !game || !uid) return null

    let data = readAll()
    let record = data?.[qq]
    if (!record || record.date !== today()) record = { date: today(), games: {} }
    if (!record.games || typeof record.games !== 'object' || Array.isArray(record.games)) record.games = {}
    if (!record.games[game] || typeof record.games[game] !== 'object' || Array.isArray(record.games[game]))
        record.games[game] = {}

    record.games[game][uid] = signed === true
    data[qq] = record
    writeAll(data)
    return record
}

function getStatus(qq, game, uid) {
    let record = getRecord(qq)
    if (!record) return null
    let value = record.games?.[normalize(game)]?.[normalize(uid)]
    return typeof value === 'boolean' ? value : null
}

function isAllSigned(qq, uids = {}, games = []) {
    let record = getRecord(qq)
    if (!record) return false

    let targets = []
    for (let game of games || [])
        for (let uid of uids?.[game] || [])
            targets.push([normalize(game), normalize(uid)])

    if (targets.length === 0) return false
    return targets.every(([game, uid]) => record.games?.[game]?.[uid] === true)
}

export default {
    file: cacheFile,
    getRecord,
    getStatus,
    setStatus,
    isAllSigned
}
