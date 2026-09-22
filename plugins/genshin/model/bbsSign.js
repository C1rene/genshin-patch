import common from '../../../lib/common/common.js'
import cfg from '../../../lib/config/config.js'
import MysApi from './mys/mysApi.js'
import base from './base.js'
import Data from './Data.js'
import Cfg from './Cfg.js'
import BbsSignCache from './BbsSignCache.js'
import VerificationStats from './VerificationStats.js'
import SignQueue from './SignQueue.js'
import moment from 'moment'
import _ from 'lodash'

let signing = false
let finishTime
let Nosign = 0

function isMasterQQ(qq) {
    return (cfg.masterQQ || []).some(id => String(id) === String(qq))
}

export default class BBsSign extends base {
    constructor(e) {
        super(e)
        this.model = 'BBsSign'
        this.ForumData = Data.readJSON(`${Cfg.file}`, 'mys')
        this.button = segment.button([
            { text: '#扫码登录', callback: '#扫码登录' }
        ])
    }

    static async coinSign(e) {
        let BbsSign = new BBsSign(e)
        let sks = await Cfg.getsks(false, e.user_id, true)
        if (_.isEmpty(sks)) return []

        let starRail = BbsSign.getDataList('星铁')?.[0]
        let forums = BbsSign.ForumData
        if (!starRail || !Array.isArray(forums) || forums.length === 0)
            return [{ message: '', retcode: -1 }]

        let list = []
        const verificationUser = VerificationStats.context(e, e.user_id)
        for (let sk of Object.values(sks))
            list.push(await BbsSign.getCoinSign(sk, forums, starRail, verificationUser))
        return list
    }

    async getCoinSign(sk, forumData, starRail, verificationUser = {}) {
        let mysApi = new MysApi(sk.stuid, sk.sk, {}, sk.region, '', 'bbs')
        let key = `Bbs:Sign:${sk.id}`
        const qq = sk.userId
        const mysUid = sk.stuid

        try {
            // 优先读取持久化当日缓存；已经有任意板块签到成功则米币签到视为完成。
            let cachedCoinStatus = BbsSignCache.getCoinStatus(qq, mysUid)
            if (cachedCoinStatus === true) {
                await this.setCache(key)
                return { message: '', retcode: 100 }
            }

            let device_fp = await mysApi.getData('getFp')
            device_fp = device_fp?.data?.device_fp
            this.device_fp = device_fp

            let queryError = null

            if (cachedCoinStatus !== false) {
                for (let item of forumData) {
                    const forumId = item?.signId ?? item?.id
                    let cachedForumStatus = BbsSignCache.getForumStatus(qq, mysUid, forumId)

                    // 米币签到只要确认任意一个板块已签到就立即结束，不再继续查询。
                    if (cachedForumStatus === true) {
                        BbsSignCache.setCoinStatus(qq, mysUid, true)
                        await this.setCache(key)
                        return { message: '', retcode: 100 }
                    }
                    if (cachedForumStatus === false) continue

                    let forum = {
                        ...item,
                        headers: { 'x-rpc-device_fp': device_fp }
                    }

                    await common.sleep(1000)
                    let res = await mysApi.getData('querySignInStatus', forum)

                    if (res?.retcode === -100) {
                        if (this.set.Autodelsk) await Cfg.delsk(sk.userId, mysApi.uid)
                        return { message: '', retcode: -100 }
                    }

                    if (res?.retcode !== 0) {
                        if (queryError === null) queryError = res?.retcode ?? -1
                        continue
                    }

                    if (res?.data?.is_signed === true) {
                        BbsSignCache.setForumStatus(qq, mysUid, forumId, true)
                        await this.setCache(key)
                        return { message: '', retcode: 100 }
                    }

                    if (res?.data?.is_signed === false)
                        BbsSignCache.setForumStatus(qq, mysUid, forumId, false)
                }

                if (queryError !== null)
                    return { message: '', retcode: queryError }

                BbsSignCache.setCoinStatus(qq, mysUid, false)
            }

            let starRailId = starRail?.signId ?? starRail?.id
            let forum = {
                ...starRail,
                headers: { 'x-rpc-device_fp': device_fp }
            }

            await common.sleep(1000)
            let res = await mysApi.getData('bbsSign', forum)

            if (res?.retcode === 1034) {
                let retry = 0
                let challenge = await this.bbsGeetest(mysApi, '', {}, verificationUser)
                while (!challenge && retry < this.set.bbsRetry) {
                    challenge = await this.bbsGeetest(mysApi, '', {}, verificationUser)
                    retry++
                }

                if (challenge) {
                    forum = {
                        ...forum,
                        headers: {
                            'x-rpc-device_fp': device_fp,
                            'x-rpc-challenge': challenge
                        }
                    }
                    res = await mysApi.getData('bbsSign', forum)
                }
            }

            logger.mark(`${sk.id}:${starRail.name} 米币签到结果: [${res?.message || res?.retcode}]`)
            if (res?.retcode === 0) {
                BbsSignCache.setForumStatus(qq, mysUid, starRailId, true)
                BbsSignCache.setCoinStatus(qq, mysUid, true)
                await this.setCache(key)
                return { message: '', retcode: 0 }
            }

            BbsSignCache.setForumStatus(qq, mysUid, starRailId, false)
            BbsSignCache.setCoinStatus(qq, mysUid, false)
            return { message: '', retcode: res?.retcode ?? -1 }
        } catch (ex) {
            logger.error(`米币签到异常：${ex}`)
            return { message: '', retcode: -1 }
        }
    }

    static async bbsSign(e, name) {
        let BbsSign = new BBsSign(e)

        let sks = await Cfg.getsks(false, e.user_id, true)
        if (_.isEmpty(sks)) {
            e.reply(['\n请【#扫码登录】后签到米币', BbsSign.button], false, { at: true })
            return false
        }

        let data = BbsSign.getDataList(name)
        let list = []
        const verificationUser = VerificationStats.context(e, e.user_id)

        for (let sk of Object.values(sks)) {
            let res = await BbsSign.getbbsSign(sk, data, 10, verificationUser)
            if (Object.keys(sks).length > 1 && res?.message)
                res.message = `**通行证ID: ${sk.stuid}**\n${res.message}`
            list.push(res)
        }
        return list
    }

    static async communityTask(e, targetQQs = []) {
        let BbsSign = new BBsSign(e)
        let forumData = BbsSign.ForumData
        let results = []
        let verificationUser = VerificationStats.context(e, e?.user_id)

        for (let qq of [...new Set(targetQQs.map(v => String(v)))]) {
            if (!SignQueue.tryAcquire(qq)) {
                results.push({ qq, message: '前置签到正在执行中' })
                continue
            }

            try {
                let sks = await Cfg.getsks(false, qq, true)
                if (_.isEmpty(sks)) {
                    results.push({ qq, message: '未找到可用stoken' })
                    continue
                }

                let messages = []
                for (let sk of Object.values(sks)) {
                    let res = await BbsSign.getbbsSign(sk, forumData, 10, verificationUser)
                    if (Object.keys(sks).length > 1)
                        messages.push(`**通行证ID: ${sk.stuid}**\n${res?.message || '无结果'}`)
                    else
                        messages.push(res?.message || '无结果')
                }

                results.push({ qq, message: messages.filter(Boolean).join('\n') })
            } finally {
                SignQueue.release(qq)
            }
        }

        return results
    }

    async getbbsSign(sk, forumData, likeTarget = 10, verificationUser = {}) {
        let message = ''
        let retcode = 0
        const qq = sk.userId
        const mysUid = sk.stuid
        let mysApi = new MysApi(sk.stuid, sk.sk, {}, sk.region, '', 'bbs')

        try {
            let device_fp = await mysApi.getData('getFp')
            device_fp = device_fp?.data?.device_fp
            this.device_fp = device_fp

            for (let forumItem of forumData) {
                const forumLikeTarget = 10
                const forumLikeAttemptLimit = 20
                const forumId = forumItem?.signId ?? forumItem?.id
                let forumVote = BbsSignCache.getForumLikes(qq, mysUid, forumId)
                let forumVoteAttempts = 0
                let forum = {
                    ...forumItem,
                    headers: { 'x-rpc-device_fp': device_fp }
                }

                message += `${message ? '\n' : ''}**${forumItem.name}**\n`

                let cachedForumStatus = BbsSignCache.getForumStatus(qq, mysUid, forumId)
                let shouldSign = cachedForumStatus === false

                if (cachedForumStatus === true) {
                    message += '社区签到: 今日已签到\n'
                } else if (cachedForumStatus === null) {
                    await common.sleep(1000)
                    let signStatus = await mysApi.getData('querySignInStatus', forum)

                    if (signStatus?.data?.is_signed === true) {
                        BbsSignCache.setForumStatus(qq, mysUid, forumId, true)
                        cachedForumStatus = true
                        message += '社区签到: 今日已签到\n'
                    } else if (signStatus?.retcode === -100) {
                        return { message: '登录失效，请【#扫码登录】', retcode: -100 }
                    } else if (signStatus?.retcode !== 0 || signStatus?.data?.is_signed !== false) {
                        message += `社区签到: 签到状态查询失败(${signStatus?.message || `retcode=${signStatus?.retcode}`})\n`
                        retcode = 1034
                    } else {
                        BbsSignCache.setForumStatus(qq, mysUid, forumId, false)
                        cachedForumStatus = false
                        shouldSign = true
                    }
                }

                if (shouldSign) {
                    await common.sleep(1000)
                    let signRes = await mysApi.getData('bbsSign', forum)

                    if (signRes?.retcode === 1034) {
                        let retry = 0
                        let challenge = await this.bbsGeetest(mysApi, '', {}, verificationUser)
                        while (!challenge && retry < this.set.bbsRetry) {
                            challenge = await this.bbsGeetest(mysApi, '', {}, verificationUser)
                            retry++
                        }

                        if (challenge) {
                            forum = {
                                ...forum,
                                headers: {
                                    'x-rpc-device_fp': device_fp,
                                    'x-rpc-challenge': challenge
                                }
                            }
                            signRes = await mysApi.getData('bbsSign', forum)
                            message += `社区签到: 验证码${signRes?.retcode === 0 ? '成功' : '失败'}\n`
                        } else {
                            message += '社区签到: 验证码失败\n'
                        }
                    } else {
                        message += `社区签到: ${signRes?.message || (signRes?.retcode === 0 ? '成功' : `retcode=${signRes?.retcode}`)}\n`
                    }

                    if (signRes?.retcode === 0) {
                        BbsSignCache.setForumStatus(qq, mysUid, forumId, true)
                        cachedForumStatus = true
                    } else {
                        BbsSignCache.setForumStatus(qq, mysUid, forumId, false)
                        cachedForumStatus = false
                        retcode = 1034
                    }
                    logger.mark(`${sk.id}:${forumItem.name} 社区签到结果: [${signRes?.message || signRes?.retcode}]`)
                }

                // 点赞成功数按板块、按米游社UID持久化；尝试次数只统计本次执行。
                forumVote = BbsSignCache.getForumLikes(qq, mysUid, forumId)
                if (forumVote < forumLikeTarget) {
                    await common.sleep(1000)
                    let listRes = await mysApi.getData('bbsPostList', forum)
                    let listRetry = 0

                    while ((!listRes?.data?.list || listRes.data.list.length === 0) && listRetry < 2) {
                        await common.sleep(_.random(2) * 100 + 50)
                        listRes = await mysApi.getData('bbsPostList', forum)
                        listRetry++
                    }

                    if (Array.isArray(listRes?.data?.list)) {
                        for (let post of listRes.data.list) {
                            if (forumVote >= forumLikeTarget || forumVoteAttempts >= forumLikeAttemptLimit) break

                            let postId = post?.post?.post_id
                            if (!postId) continue

                            forumVoteAttempts++
                            let data = {
                                postId,
                                headers: { 'x-rpc-device_fp': device_fp }
                            }

                            await common.sleep(1000)
                            let voteRes = await mysApi.getData('bbsVotePost', data)
                            if (voteRes?.retcode === 1034)
                                voteRes = await this.bbsGeetest(mysApi, 'bbsVotePost', data, verificationUser)

                            if (voteRes?.retcode === 0) {
                                forumVote = BbsSignCache.addForumLike(qq, mysUid, forumId, 1)
                            } else {
                                logger.mark(`${sk.id}:${forumItem.name} 帖子${postId}点赞失败，继续下一篇: [${voteRes?.retcode}:${voteRes?.message}]`)
                            }
                        }
                    } else {
                        retcode = 1034
                    }
                }

                let finalSigned = BbsSignCache.getForumStatus(qq, mysUid, forumId) === true
                let finalLikes = BbsSignCache.getForumLikes(qq, mysUid, forumId)
                if (!finalSigned || finalLikes < forumLikeTarget)
                    retcode = 1034

                message += `点赞：${finalLikes}  尝试：${forumVoteAttempts}\n`
            }
        } catch (ex) {
            logger.error(`社区签到异常：${ex}`)
            message += `${message ? '\n' : ''}社区签到异常`
            retcode = 1034
        }

        return { message, retcode }
    }

    async bbsTask(manual, targetQQs = null) {
        if (!this.set.AutobbsSign && !manual) return

        if (signing) {
            if (manual) await this.e.reply('米币签到任务进行中，完成前请勿重复执行')
            return
        }

        let { sks, ltuids } = await Cfg.signSk(targetQQs)
        if (ltuids.length <= 0) {
            if (manual) await this.e.reply('暂无sk需要米币签到')
            return
        }

        let forums = this.ForumData
        let starRail = this.getDataList('星铁')?.[0]
        if (!Array.isArray(forums) || forums.length === 0 || !starRail) {
            if (manual) await this.e.reply('米币签到配置异常')
            return
        }

        let pending = []
        this.finshNum = 0

        for (let id of ltuids) {
            let sk = sks[id]
            let ownerFull = !manual && isMasterQQ(sk?.userId)

            if (ownerFull) {
                if (BbsSignCache.isAllForumsComplete(sk.userId, sk.stuid, forums)) {
                    this.finshNum++
                    continue
                }
            } else {
                let coinCached = BbsSignCache.getCoinStatus(sk?.userId, sk?.stuid)
                if (coinCached === true || await redis.get(`Bbs:Sign:${id}`)) {
                    if (coinCached !== true)
                        BbsSignCache.setCoinStatus(sk?.userId, sk?.stuid, true)
                    this.finshNum++
                    continue
                }
            }

            pending.push({ id, sk, ownerFull })
        }

        if (pending.length <= 0) {
            if (manual) await this.e.reply('暂无sk需要米币签到')
            return
        }

        // 自动/主人批量任务按 QQ 使用共享签到锁。同一 QQ 有多个 stoken 时只获取一次锁。
        let taskLocks = new Set()
        let busyQQs = new Set()
        pending = pending.filter(item => {
            let qq = String(item.sk?.userId ?? '')
            if (!qq) return false
            if (taskLocks.has(qq)) return true
            if (busyQQs.has(qq)) return false
            if (SignQueue.tryAcquire(qq)) {
                taskLocks.add(qq)
                return true
            }
            busyQQs.add(qq)
            return false
        })

        if (busyQQs.size > 0)
            logger.mark(`[签到队列]米币任务跳过正在执行前置签到的QQ：${[...busyQQs].join(',')}`)

        if (pending.length <= 0) {
            SignQueue.releaseMany(taskLocks)
            if (manual) await this.e.reply('前置签到正在执行中')
            return
        }

        Nosign = pending.length
        signing = true
        try {
        const START = moment().unix()

        this.sucNum = 0
        this.failNum = 0
        this.invalidNum = 0
        this.invalidqq = []

        let tips = [
            '【开始米币签到任务】',
            `\n米币签到：${ltuids.length}个 | 待处理：${pending.length}个`
        ]
        logger.mark(`米币签到sk:${ltuids.length}个，待处理:${pending.length}个`)
        await this.send(manual, tips)

        let promises = []

        for (let item of pending) {
            let verificationUser = manual
                ? VerificationStats.context(this.e, this.e?.user_id)
                : VerificationStats.context(null, item.sk.userId)

            // 仅自动米币签到任务中，主人账号升级为完整 #mys全部签到。
            if (item.ownerFull) {
                let res = await this.getbbsSign(item.sk, forums, 10, verificationUser)
                await this.result(res, item.sk.userId)
                continue
            }

            if (this.set.ddos) {
                promises.push(
                    this.getCoinSign(item.sk, forums, starRail, verificationUser)
                        .then(resp => ({ userId: item.sk.userId, ...resp }))
                )
            } else {
                let res = await this.getCoinSign(item.sk, forums, starRail, verificationUser)
                await this.result(res, item.sk.userId)
            }
        }

        if (promises.length) {
            let ret = []
            try {
                ret = await Promise.all(promises)
            } catch (error) {
                logger.error(error)
            }
            for (let res of ret)
                await this.result(res, res.userId)
        }

        const END = moment().unix()
        let msg = `【米币签到任务完成】\n总耗时：${Cfg.countTime(END - START)}\n成功：${this.sucNum} | 已签：${this.finshNum} | 失败：${this.failNum}`

        if (this.invalidNum > 0) {
            msg += `\nsk失效：${this.invalidNum} | 失效qq:\n`
            let qq = this.invalidqq.slice()
            let qqnum = this.set.invalid || 2
            msg += qq.map((e, i) => {
                let line = `${i + 1}. ${e}`
                if ((i + 1) % qqnum === 0) line += '\n'
                else line += '，'
                return line
            })
        }

        await this.send(manual, msg)
        } finally {
            signing = false
            Nosign = 0
            SignQueue.releaseMany(taskLocks)
        }
    }

    async send(manual, msg) {
        if (manual) {
            await this.e.reply(msg)
            return
        }

        await common.relpyPrivate(cfg.masterQQ[0], msg)
        if (this.white.bbsPush?.length > 0)
            for (let group of this.white.bbsPush)
                try {
                    let split = group.split(':')
                    let group_id = Number(split[1]) || split[1]
                    if (Array.isArray(Bot.uin))
                        await Bot[split[0]].pickGroup(group_id).sendMsg(msg)
                    else
                        await Bot.pickGroup(group_id).sendMsg(msg)
                } catch (error) {
                    logger.error(error)
                }
    }

    async result(res, userId) {
        Nosign = Math.max(0, Nosign - 1)
        if (res?.retcode === 0) this.sucNum++
        else if (res?.retcode === 100) this.finshNum++
        else if (res?.retcode === -100) {
            this.invalidNum++
            if (!this.invalidqq?.includes(userId))
                this.invalidqq.push(userId)
        } else {
            this.failNum++
        }
    }

    async bbsGeetest(mysApi, type = '', data = {}, verificationUser = {}) {
        VerificationStats.addTriggered(verificationUser)
        let api = Cfg.getConfig('api')
        let vall = new MysApi(mysApi.uid, mysApi.cookie, {}, '', '', 'all')
        let headers = { 'x-rpc-device_fp': this.device_fp }
        let res = await mysApi.getData('bbsGetCaptcha', { headers })
        let retry = 0
        let test_nine = res

        if (api.type == 0) {
            res = await vall.getData('test_nine', res?.data)
            if (res?.data?.validate) {
                res = {
                    data: {
                        challenge: test_nine?.data?.challenge,
                        validate: res?.data?.validate
                    }
                }
            }
        } else if (api.type == 1) {
            res = await vall.getData('signrecognize', res.data)
            if (res?.resultid) {
                let results = res
                await common.sleep(5000)
                res = await vall.getData('results', results)
                while ((res?.status == 2) && retry < 10) {
                    await common.sleep(5000)
                    res = await vall.getData('results', results)
                    retry++
                }
            }
        } else if (api.type == 2) {
            res = await vall.getData('in', res.data)
            if (res?.request) {
                let request = res
                await common.sleep(5000)
                res = await vall.getData('res', request)
                while ((res?.request == 'CAPCHA_NOT_READY') && retry < 10) {
                    await common.sleep(5000)
                    res = await vall.getData('res', request)
                    retry++
                }
            }
        }

        try {
            if (res?.data?.validate || res?.request?.geetest_validate) {
                res = await mysApi.getData('bbsCaptchaVerify', res?.data || res?.request)
                if (res?.data?.challenge)
                    VerificationStats.addPassed(verificationUser)

                if (type) {
                    if (res?.data?.challenge)
                        return await mysApi.getData(type, {
                            ...data,
                            headers: {
                                'x-rpc-challenge': res.data.challenge,
                                'x-rpc-device_fp': this.device_fp
                            }
                        })
                } else {
                    return res?.data?.challenge || ''
                }
            }
        } catch (error) {
            logger.error('[validate][接口请求]异常信息：' + error)
            return ''
        }
        return ''
    }

    async setCache(key) {
        let end = Number(moment().endOf('day').format('X')) - Number(moment().format('X'))
        if (!await redis.get(key))
            await redis.setEx(key, end, '1')
    }

    getDataList(name) {
        let otherName = _.map(this.ForumData, 'otherName')
        for (let [index, item] of Object.entries(otherName)) {
            if (item?.includes(name))
                return [this.ForumData[index]]
        }
        return this.ForumData
    }
}
