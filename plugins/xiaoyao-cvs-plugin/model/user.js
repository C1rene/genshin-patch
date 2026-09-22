import YAML from 'yaml'
import miHoYoApi from "../model/mys/mihoyoApi.js"
import fs from 'node:fs'
import lodash from 'lodash'
import utils from '../model/mys/utils.js';
import gsCfg from './gsCfg.js';
import {
    isV3
} from '../components/Changelog.js';
import {
    Cfg,
    Data
} from "../components/index.js";
import moment from 'moment'

const _path = process.cwd();
const plugin = "xiaoyao-cvs-plugin"
const nameData = ["原神", "崩坏3", "崩坏2", "未定事件簿"];
const yamlDataUrl = `${_path}/plugins/xiaoyao-cvs-plugin/data/yaml`;
/** 配置文件 */
export default class user {
    constructor(e) {
        this.e = e;
        this.stokenPath = `./plugins/${plugin}/data/yaml/`
        this.ForumData = Data.readJSON(`${_path}/plugins/xiaoyao-cvs-plugin/defSet/json`, "mys")
        this.configSign = gsCfg.getfileYaml(`${_path}/plugins/xiaoyao-cvs-plugin/config/`, "config");
        this.configSign.signlist = this.configSign.signlist || "原神|崩坏3|崩坏2|未定事件簿".split("|")
        this.getToken = this.configSign.getToken || ''
    }

    async getCkData() {
        let sumData = {};
        let mysres = await this.bbsSeachSign();
        if (mysres.retcode === 0) {
            sumData["米游社"] = {
                "米游币任务": mysres.data.can_get_points != 0 ? "未完成" : "已完成",
                "米游币余额": mysres.data.total_points,
                "今日剩余可获取": mysres.data.can_get_points
            }
        }
        let resSign = await this.multiSign(this.ForumData);
        if (resSign?.upData) {
            for (let item of resSign?.upData) {
                let num = lodash.random(0, 9999);
                item.upName = item.upName == "原神" ? "ys" : item.upName == "崩坏3" ? "bh3" : item.upName ==
                    "崩坏2" ? "bh2" : item.upName == "未定事件簿" ? "wdy" : item.upName
                sumData[item.upName + "" + num] = {
                    "uid": item.game_uid,
                    "游戏昵称": item.nickname,
                    "等级": item.level,
                    "今日签到": item.is_sign ? "已签到" : "未签到",
                    "累计签到": item.total_sign_day + "天",
                    "今天奖励": item.awards
                }
            }
        }
        return sumData;
    }

    async getData(type, data = {}, isck = true) {
        if (isck) {
            await this.cookie(this.e)
        }
        this.miHoYoApi = new miHoYoApi(this.e);
        let res = await this.miHoYoApi.getData(type, data)
        return res
    }

    async multiSign(forumData, isCk = false) {
        let upData = [],
            message = '';
        if (isCk) {
            await this.cookie(this.e)
        }
        for (let forum of forumData) {
            if (!(this.configSign.signlist.includes(forum.name))) {
                continue;
            }
            let res
            try {
                message += `**${forum.name}**\n`
                res = await this.getData("userGameInfo", forum, false)
                await utils.sleepAsync(3000) //等几毫秒免得请求太频繁了
                if (res.retcode === -100) {
                    message = `用户：${this.e.user_id}：cookie失效`
                    return {
                        message,
                        upData
                    };
                }
                if (res?.data?.list?.length === 0 || !res?.data?.list) {
                    message += `签到: 未绑定${forum.name}信息\n`;
                    if (this.allSign) {
                        this.allSign[forum.name].bindGame++;
                    }
                    await utils.randomSleepAsync()
                    continue;
                }
                message += `${forum.name}共计${res?.data?.list.length}个账号\n`;

                for (let item of res?.data?.list) {
                    let data = Object.assign({}, forum, item)
                    item.is_sign = true;
                    item.upName = forum.name
                    res = await this.getData("isSign", data, false)
                    await utils.sleepAsync(500)
                    item.total_sign_day = res?.data?.total_sign_day
                    if (res?.data?.is_sign) {
                        if (this.allSign) {
                            this.allSign[forum.name].isSign++;
                        }
                        message += `${item.nickname}-${item.game_uid}：今日已签到~\n`;
                    } else {
                        let signMsg = '';
                        for (let i = 0; i < 2; i++) { //循环请求
                            await utils.sleepAsync(2000)
                            res = await this.getData("sign", data, false)
                            if (res?.data?.gt) {
                                let validate = await this.geetest(res.data)
                                if (validate) {
                                    let header = {}
                                    header["x-rpc-challenge"] = res["data"]["challenge"]
                                    header["x-rpc-validate"] = validate
                                    header["x-rpc-seccode"] = `${validate}|jordan`
                                    data.headers = header
                                    res = await this.getData("sign", data, false)
                                    if (!res?.data?.gt) {
                                        if (this.allSign) {
                                            this.allSign[forum.name].sign++;
                                        }
                                        signMsg = `${item.nickname}-${item.game_uid}:验证码签到成功~\n`
                                        item.total_sign_day++;
                                        break;
                                    } else {
                                        if (this.allSign) {
                                            this.allSign[forum.name].error++;
                                        }
                                        item.is_sign = false;
                                        signMsg =
                                            `${item.nickname}-${item.game_uid}:签到出现验证码~\n请晚点后重试，或者手动上米游社签到\n`;
                                    }
                                } else {
                                    if (this.allSign) {
                                        this.allSign[forum.name].error++;
                                    }
                                    signMsg = `${item.nickname}-${item.game_uid}:验证码失败~\n`
                                }

                            } else {
                                if (this.allSign) {
                                    this.allSign[forum.name].sign++;
                                }
                                item.total_sign_day++;
                                signMsg =
                                    `${item.nickname}-${item.game_uid}：${res.message == "OK" ? "签到成功" : res.message}\n`
                                break;
                            }
                        }
                        message += signMsg
                    }
                    //获取签到信息和奖励信息
                    const SignInfo = await this.getData("home", data, false)
                    if (SignInfo) {
                        let awards = SignInfo.data.awards[item.total_sign_day - 1];
                        item.awards = awards?.name + "*" + awards?.cnt
                    }
                    upData.push(item)
                    await utils.randomSleepAsync()
                }
            } catch (e) {
                if (this.allSign) {
                    this.allSign[forum.name].error++;
                }
                Bot.logger.error(`${forum.name} 签到失败 [${res?.message}]`);
                message += `签到失败: [${res?.message}]\n`;
            }
        }
        return {
            message,
            upData
        }
    }

    async docHelp() {
        return this.configSign.cookiesDoc
    }

    async bbsSeachSign() {
        let res = await this.getData("bbsisSign", {
            name: "原神"
        })
        if (!res?.data) {
            res.message = `登录Stoken失效请重新获取cookies或stoken保存~`;
            res.isOk = false;
            this.delSytk(yamlDataUrl, this.e)
        } else {
            res.message = `当前米游币数量为：${res.data.total_points},今日剩余可获取：${res.data.can_get_points}`
            res.isOk = true;
        }
        return res;
    }

    async getbbsSign(forumData) {
        let message = '',
            challenge = '',
            res;
        try {
            res = await this.bbsSeachSign()
            if (res?.data?.can_get_points == 0) {
                return {
                    message: `签到任务已完成，无需重复签到`
                }
            }
            for (let forum of forumData) {
                let trueDetail = 0;
                let Vote = 0;
                let Share = 0;
                let sumcount = 0;
                message += `\n**${forum.name}**\n`
                res = await this.getData("bbsSign", forum, false)
                if (res?.retcode == -100) {
                    return {
                        message: '登录失效'
                    }
                }
                if (res?.retcode == 1034) {
                    challenge = await this.bbsGeetest()
                    if (challenge) {
                        forum["headers"] = {
                            "x-rpc-challenge": challenge
                        }
                        res = await this.getData("bbsSign", forum, false)
                        if (res?.retcode == 1034) {
                            message += `社区签到: 验证码失败\n`;
                        } else {
                            message += `社区签到: 验证码成功\n`;
                        }
                    } else {
                        message += `社区签到: 验证码失败\n`;
                    }
                } else {
                    message += `社区签到: ${res.message}\n`;
                }
                Bot.logger.mark(`${this.e.user_id}:${this.e.uid}:${forum.name} 社区签到结果: [${res.message}]`);
                res = await this.getData("bbsPostList", forum, false)
                sumcount++;
                let postList = res.data.list;
                let postId
                for (let post of postList) {
                    post = post.post;
                    postId = post['post_id']
                    res = await this.getData("bbsPostFull", {
                        postId
                    }, false)
                    if (res?.message && res?.retcode == 0) {
                        trueDetail++;
                    }
                    if (res?.retcode == 1034) {
                        challenge = await this.bbsGeetest()
                        if (challenge) {
                            let data = {
                                postId,
                                headers: {
                                    "x-rpc-challenge": challenge,
                                }
                            }
                            await this.getData("bbsPostFull", data, false)
                        }
                    }
                    res = await this.getData("bbsVotePost", {
                        postId
                    }, false)
                    if (res?.message && res?.retcode == 0) {
                        Vote++;
                    }
                    if (res?.retcode == 1034) {
                        challenge = await this.bbsGeetest()
                        if (challenge) {
                            let data = {
                                postId,
                                headers: {
                                    "x-rpc-challenge": challenge,
                                }
                            }
                            await this.getData("bbsVotePost", data, false)
                        }
                    }
                    await utils.randomSleepAsync(2);
                }
                res = await this.getData("bbsShareConf", {
                    postId
                }, false)
                if (res?.message && res?.retcode == 0) {
                    Share++;
                }
                message += `共读取帖子记录${20 * sumcount}\n浏览：${trueDetail}  点赞：${Vote}  分享：${Share}\n`;
                Bot.logger.mark(`\n用户${this.e.user_id}:\n${message}`)
                await utils.randomSleepAsync(3);
            }
        } catch (ex) {
            Bot.logger.error(`出问题了：${ex}`);
            message += `${this.e.user_id}获取米游币异常`;
        }
        return {
            message
        }
    }

    async bbsGeetest() {
        if (!this.getToken) return ""
        try {
            let res = await this.getData('bbsGetCaptcha', false)
            // let challenge = res.data["challenge"]
            // await this.getData("geeType", res.data, false)
            res.data.getToken = this.getToken
            res = await this.getData("validate", res.data, false)
            if (res?.data?.validate) {
                res = await this.getData("bbsCaptchaVerify", res.data, false)
                return res["data"]["challenge"]
            }
        } catch (error) {
            //大概率是数据空导致报错这种情况很少见捏，所以你可以忽略不看
            Bot.logger.error('[validate][接口请求]异常信息：' + error)
            return ""
        }
        return ""
    }

    async geetest(data) {
        if (!this.getToken) return ""
        try {
            data.getToken = this.getToken
            let res = await this.getData("validate", data, false)
            if (res?.data?.validate) {
                let validate = res?.data?.validate
                return validate
            }
        } catch (error) {
            //大概率是数据空导致报错这种情况很少见捏，所以你可以忽略不看
            Bot.logger.error('[validate][接口请求]异常信息：' + error)
            return ""
        }
        return ""
    }

    async cookie(e) {
        let {
            cookie,
            uid,
            skuid
        } = await this.getCookie(e);
        let cookiesDoc = await this.getcookiesDoc();
        if (!cookie) {
            return false;
        }
        let stokens = this.getStoken(e.user_id)
        if (!stokens) {
            return true;
        }
        if (!cookie.includes("login_ticket") && (isV3 && !skuid?.login_ticket)) {
            return false;
        }
        let flot = await this.stoken(cookie, e)
        await utils.sleepAsync(1000); //延迟加载防止文件未生成
        if (!flot) {
            return false;
        }
        return true;
    }

    async getcookiesDoc() {
        return await gsCfg.getfileYaml(`${_path}/plugins/xiaoyao-cvs-plugin/config/`, "config").cookiesDoc
    }

    async getCookie(e) {
        let skuid, cookie, uid
        if (isV3) {
            skuid = await gsCfg.getBingCookie(e.user_id); 
            cookie = skuid?.ck;
            uid = skuid?.item;
            if (!uid && e?.user?.getUid) {
                uid = e?.user?.getUid('gs')
                cookie = e?.user?.mysUser?.ck
            }
            // if (!uid && e.user) { //获取uid为空时进行后续处理获取 (临时处理方式后续会进行解耦以避免这种情况。。待咕中.)s
            // }
        } else {
            if (NoteCookie[e.user_id]) {
                cookie = NoteCookie[e.user_id].cookie;
                uid = NoteCookie[e.user_id].uid;
                skuid = NoteCookie[e.user_id];
            } else if (BotConfig.dailyNote && BotConfig.dailyNote[e.user_id]) {
                cookie = BotConfig.dailyNote[e.user_id].cookie;
                uid = BotConfig.dailyNote[e.user_id].uid;
                skuid = BotConfig.NoteCookie[e.user_id];
            }
        }
        if (!uid) {
            uid = e.runtime?.user?._regUid
        }
        this.e.uid = uid;
        this.e.cookie = cookie;
        return {
            cookie,
            uid,
            skuid
        }
    }

    async stoken(cookie, e) {
        this.e = e;
        let datalist = this.getStoken(e.user_id) || {}
        if (Object.keys(datalist).length > 0) {
            return true;
        }
        const map = await utils.getCookieMap(cookie);
        let loginTicket = map?.get("login_ticket");
        const loginUid = map?.get("login_uid") ? map?.get("login_uid") : map?.get("ltuid");
        if (isV3) {
            loginTicket = gsCfg.getBingCookie(e.user_id).login_ticket
        }
        let mhyapi = new miHoYoApi(this.e);
        let res = await mhyapi.getData("bbsStoken", {
            loginUid,
            loginTicket
        }, false)
        if (res?.data) {
            datalist[e.uid] = {
                stuid: map?.get("account_id"),
                stoken: res.data.list[0].token,
                ltoken: res.data.list[1].token,
                uid: e.uid,
                userId: e.user_id,
                is_sign: true
            }
            gsCfg.saveBingStoken(e.user_id, datalist)
        }
        return true;
    }

    getStoken(userId) {
        let file = `${yamlDataUrl}/${userId}.yaml`
        try {
            let ck = fs.readFileSync(file, 'utf-8')
            ck = YAML.parse(ck)
            if (ck?.uid) {
                let datalist = {};
                ck.userId = this.e.user_id
                datalist[ck.uid] = ck;
                ck = datalist
                gsCfg.saveBingStoken(this.e.user_id, datalist)
            }
            return ck[this.e.uid] || {}
        } catch (error) {
            return {}
        }
    }

    async seachUid(data) {
        let ltoken = '', v2Sk;
        if (data?.data) {
            let res;
            if (this.e.sk) {
                if (this.e.sk.get('stoken').includes('v2_')) {
                    res = await this.getData('getLtoken', { cookies: this.e.raw_message }, false)
                    ltoken = res?.data?.ltoken
                } else {
                    v2Sk = await this.getData('getByStokenV2', { headers: { Cookie: this.e.raw_message } }, false)
                }
                this.e.cookie =
                    `ltoken=${this.e.sk?.get('ltoken') || ltoken};ltuid=${this.e.sk?.get('stuid')};cookie_token=${data.data.cookie_token}; account_id=${this.e.sk?.get('stuid')};`
                // if(this.e.sk?.get('mid')){
                // 	this.e.cookie =
                // 		`ltoken_v2=${this.e.sk?.get('ltoken')||ltoken};cookie_token_v2=${data.data.cookie_token}; account_mid_v2=${this.e.sk.get('mid')};ltmid_v2=${this.e.sk.get('mid')}`
                // }
            } else {
                this.e.cookie = this.e.original_msg //发送的为cookies
                this.cookies = `stuid=${this.e.stuid};stoken=${data?.data?.list[0].token};ltoken=${data?.data?.list[1].token}`
                res = await this.getData('getLtoken', { cookies: this.cookies }, false)
                v2Sk = await this.getData('getByStokenV2', { headers: { Cookie: this.cookies } }, false)
            }
            let list = []
            for (let item of ['崩坏星穹铁道', '原神']) {
                let result = await this.getData("userGameInfo", this.getDataList(item)[0], false)
                if (result?.retcode != 0) {
                    continue;
                }
                list.push(...result?.data?.list)
            }
            if (list.length == 0) return false;
            let uids = []
            for (let s of list) {
                let datalist = {}
                let uid = s.game_uid
                uids.push(s.region_name + ':' + uid)
                datalist[uid] = {
                    stuid: this.e?.sk?.get('stuid') || this.e.stuid,
                    stoken: v2Sk?.data?.token?.token || this.e?.sk?.get('stoken') || data?.data?.list[0].token,
                    ltoken: this.e?.sk?.get('ltoken') || ltoken || data?.data?.list[1].token,
                    mid: this.e?.sk?.get('mid') || v2Sk?.data?.user_info?.mid,
                    uid: uid,
                    userId: this.e.user_id,
                    is_sign: true,
                    region_name: s.region_name,
                    region: s.region
                }
                await gsCfg.saveBingStoken(this.e.user_id, datalist)
            }
            let msg = `${uids.join('\n')}\nstoken绑定成功您可通过下列指令进行操作:`;
            msg += '\n【#米币查询】查询米游币余额'
            msg += '\n【#mys原神签到】获取米游币'
            msg += '\n【#更新抽卡记录】更新抽卡记录'
            msg += '\n【#刷新ck】刷新失效cookie'
            msg += '\n【#我的stoken】查看绑定信息'
            msg += '\n【#删除stoken】删除绑定信息'
            this.e.reply(msg)
        }
    }

    async delSytk(path = yamlDataUrl, e) {
        await this.getCookie(e);
        let file = `${path}/${e.user_id}.yaml`
        fs.exists(file, (exists) => {
            if (!exists) {
                return true;
            }
            let ck = fs.readFileSync(file, 'utf-8')
            ck = YAML.parse(ck)
            if (ck) {
                if (!ck[e.uid]) {
                    return true;
                }
                let sk = ck[e.uid]
                lodash.forEach(ck, (v, i) => {
                    if (sk?.stoken === v?.stoken) {
                        delete ck[i];
                    }
                })
                if (Object.keys(ck).length === 0) {
                    fs.unlinkSync(file);
                } else {
                    ck = YAML.stringify(ck)
                    fs.writeFileSync(file, ck, 'utf8')
                }
            }
            e.reply('已删除stoken')
            return true;
        })
    }

    getDataList(name) {
        let otherName = lodash.map(this.ForumData, 'otherName')
        for (let [index, item] of Object.entries(otherName)) {
            if (item.includes(name)) { //循环结束未找到的时候返回原数组签到全部
                return [this.ForumData[index]]
            }
        }
        return this.ForumData;
    }
}
