import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import fetch from 'node-fetch'
import moment from 'moment'
import fs from 'fs'
import base from './base.js'

if (!fs.existsSync('./data/srPayLog/')) {
  fs.mkdirSync('./data/srPayLog/', { recursive: true })
}

export class SrPayData {
  constructor (authKey = '', uid = '', region = '') {
    this.#authkey = encodeURIComponent(authKey)
    this.#starRailId = String(uid || '')
    this.#region = region || ''
  }

  #starRailId = ''
  #region = ''
  #authkey = ''

  #dreamsData = []
  #stellarData = []

  #seenDreamEndIds = new Set()
  #seenStellarEndIds = new Set()
  #seenDreamRecordIds = new Set()
  #seenStellarRecordIds = new Set()

  async getOringinalData (id = '') {
    return await this.getPagedData('dreams', id)
  }

  async getStellarData (id = '') {
    return await this.getPagedData('stellar', id)
  }

  async getPagedData (type, id = '') {
    const isStellar = type === 'stellar'
    const label = isStellar ? '星铁星琼记录' : '星铁充值记录'
    const url = this.getUrl(type) + encodeURIComponent(id || '')

    let res
    try {
      res = await fetch(url, this.headers)
    } catch (error) {
      console.error(`[${label}][请求异常]`, error)
      return { errorMsg: `${label}接口请求失败：${error?.message || error}` }
    }

    let text = ''
    try {
      text = await res.text()
    } catch (error) {
      console.error(`[${label}][读取响应异常]`, error)
      return { errorMsg: `${label}接口响应读取失败：${error?.message || error}` }
    }

    let ret
    try {
      ret = JSON.parse(text)
    } catch (error) {
      console.error(`[${label}][非JSON返回]`, {
        status: res.status,
        contentType: res.headers?.get?.('content-type'),
        body: text.slice(0, 500)
      })
      return {
        errorMsg: `${label}接口返回异常（HTTP ${res.status}）：${text.slice(0, 180) || '空响应'}`
      }
    }

    const check = this.checkResult(ret, label)
    if (check?.errorMsg) return check

    const list = ret?.data?.list
    if (!Array.isArray(list)) {
      console.error(`[${label}][数据结构异常]`, ret)
      return {
        errorMsg: `${label}数据结构异常：${ret?.message || ret?.retcode || '未返回data.list'}`
      }
    }

    if (!this.#starRailId && list[0]?.uid) {
      this.#starRailId = String(list[0].uid)
    }

    const target = isStellar ? this.#stellarData : this.#dreamsData
    const seenRecordIds = isStellar ? this.#seenStellarRecordIds : this.#seenDreamRecordIds

    for (const item of list) {
      const recordId = String(item?.id || '')
      if (recordId) {
        if (seenRecordIds.has(recordId)) continue
        seenRecordIds.add(recordId)
      }
      target.push(item)
    }

    if (list.length === 20) {
      const endId = String(list[19]?.id || '')
      if (!endId) {
        console.error(`[${label}] 满20条但最后一条不存在id：`, list[19])
        return { errorMsg: `${label}分页失败：最后一条记录缺少id` }
      }

      const seenEndIds = isStellar ? this.#seenStellarEndIds : this.#seenDreamEndIds
      if (seenEndIds.has(endId)) {
        console.error(`[${label}] 检测到重复分页游标：`, endId)
        return { errorMsg: `${label}分页异常：接口返回了重复游标` }
      }
      seenEndIds.add(endId)

      return await this.getPagedData(type, endId)
    }

    return true
  }

  checkResult (ret, label = '星铁充值记录') {
    if (ret?.retcode === -101 || ret?.retcode === -100) {
      return ret.retcode === -101
        ? { errorMsg: '您的链接过期，请重新获取' }
        : { errorMsg: '链接不正确，请重新获取' }
    }

    if (/unknown auth appid/i.test(ret?.message || '')) {
      return { errorMsg: `当前authkey无法获取${label}` }
    }

    if (ret?.retcode !== undefined && ret?.retcode !== 0) {
      return { errorMsg: `${label}请求失败：${ret?.message || ret?.retcode}` }
    }

    return { errorMsg: '' }
  }

  async filtrateData () {
    const dreamsResult = await this.getOringinalData()
    if (dreamsResult?.errorMsg) return dreamsResult

    const stellarResult = await this.getStellarData()
    if (stellarResult?.errorMsg) return stellarResult

    if (this.#dreamsData.length === 0 && this.#stellarData.length === 0) {
      return { errorMsg: '未获取到您的任何充值或星琼流水数据' }
    }

    if (!this.#starRailId) {
      const row = this.#dreamsData.find(v => v?.uid) || this.#stellarData.find(v => v?.uid)
      this.#starRailId = String(row?.uid || '')
    }

    this.sortRecords(this.#dreamsData)
    this.sortRecords(this.#stellarData)

    const directDreams = [8080, 3880, 2240, 1090, 330, 60]
    const firstBonusDreams = [12960, 6560, 3960, 1960, 600, 120]

    const monthMap = new Map()
    let totalDreams = 0
    let recognizedCount = 0

    const ensureMonth = (item) => {
      const logTime = item?.time || item?.datetime || ''
      const date = moment(logTime)
      if (!date.isValid()) {
        console.error('[星铁充值记录] 无法识别时间：', item)
        return null
      }

      const key = date.format('YYYY-MM')
      if (!monthMap.has(key)) {
        monthMap.set(key, {
          key,
          sortTime: date.clone().startOf('month').valueOf(),
          month: `${date.month() + 1}月`,
          payNum: [0, 0, 0, 0, 0, 0, 0, 0]
        })
      }
      return monthMap.get(key)
    }

    for (const item of this.#dreamsData) {
      const num = Number(item?.add_num)
      if (!Number.isFinite(num) || num <= 0) continue

      const action = String(item?.action || '')
      let payIndex = -1

      if (num === 300 && action === '列车补给购买') {
        payIndex = 1
      } else if (action === '充值' || !action) {
        for (let i = 0; i < directDreams.length; i++) {
          if (num === directDreams[i] || num === firstBonusDreams[i]) {
            payIndex = i + 2
            break
          }
        }
      }

      if (payIndex < 0) continue

      const month = ensureMonth(item)
      if (!month) continue

      month.payNum[payIndex]++
      totalDreams += num
      recognizedCount++
    }

    for (const item of this.#stellarData) {
      const num = Number(item?.add_num)
      const action = String(item?.action || '')

      if (num !== 680 || action !== '「无名客的荣勋」奖励') continue

      const month = ensureMonth(item)
      if (!month) continue

      month.payNum[0]++
      recognizedCount++
    }

    if (recognizedCount === 0) {
      return { errorMsg: '已获取到流水，但未识别到可统计的充值记录' }
    }

    const monthData = [...monthMap.values()]
      .sort((a, b) => a.sortTime - b.sortTime)
      .map(({ month, payNum }) => ({ month, payNum }))

    return {
      uid: this.#starRailId,
      crystal: totalDreams,
      monthData
    }
  }

  sortRecords (records) {
    records.sort((a, b) => {
      const aId = String(a?.id || '0')
      const bId = String(b?.id || '0')
      try {
        const aa = BigInt(aId)
        const bb = BigInt(bId)
        if (aa === bb) return 0
        return aa > bb ? -1 : 1
      } catch (error) {
        return this.getLogTime(b) - this.getLogTime(a)
      }
    })
  }

  getLogTime (item) {
    const date = moment(item?.time || item?.datetime || '')
    return date.isValid() ? date.valueOf() : 0
  }

  headers = {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site'
    },
    referrer: 'https://webstatic.mihoyo.com/hkrpg/event/self-help-query/index.html',
    referrerPolicy: 'strict-origin-when-cross-origin',
    method: 'GET',
    mode: 'cors',
    credentials: 'include'
  }

  getUrl (type = 'dreams') {
    const baseUrl = type === 'stellar'
      ? 'https://public-operation-hkrpg.mihoyo.com/common/hkrpg_self_help_inquiry/Stellar/GetList'
      : 'https://public-operation-hkrpg.mihoyo.com/common/hkrpg_self_help_inquiry/Dreams/GetList'

    let params = ''
    params += '?selfquery_type=3'
    params += '&lang=zh-cn'
    params += '&sign_type=2'
    params += '&auth_appid=csc'
    params += '&game_biz=hkrpg_cn'
    params += '&authkey_ver=1'
    params += '&authkey=' + this.#authkey
    params += '&app_client=bbs'
    params += '&type=3'
    params += '&size=20'
    if (this.#region) {
      params += '&region=' + encodeURIComponent(this.#region)
    }
    params += '&end_id='

    return baseUrl + params
  }
}

export class HtmlData extends base {
  constructor (data = {}) {
    super()
    this.monthData = Array.isArray(data.monthData) ? data.monthData : []
    this.crystal = data.crystal || 0
    this.uid = data.uid || ''
    this.model = 'srPayLog'
  }

  crystal = 0
  uid = ''
  monthData = []

  price = [68, 30, 648, 328, 198, 98, 30, 6]

  getBarData () {
    return this.monthData.map(v => {
      return {
        type: v.month,
        sales: v.payNum.reduce((sum, val, index) => sum + val * this.price[index], 0)
      }
    })
  }

  getTopData () {
    const maxMonth = this.maxcConsumption()
    const sum = this.sumConsumption()
    return [
      {
        title: '总消费',
        value: '￥' + this.getBarData().reduce((total, val) => total + val.sales, 0)
      },
      {
        title: '总梦华',
        value: this.crystal
      },
      {
        title: '消费最多',
        value: maxMonth.type
      },
      {
        title: maxMonth.type + '消费',
        value: '￥' + maxMonth.sales
      },
      ...sum
    ]
  }

  getPieData () {
    const data = this.sumConsumption()
    let pieData = []

    data.forEach((val, index) => {
      const value = val.value * this.price[index]
      if (value) {
        pieData.push({
          value,
          name: val.title
        })
      }
    })

    return pieData
  }

  maxcConsumption () {
    const data = this.getBarData()
    if (data.length === 0) return { type: '-', sales: 0 }

    return [...data].sort((a, b) => b.sales - a.sales)[0]
  }

  sumConsumption () {
    const titles = ['大月卡', '小月卡', '648', '328', '198', '98', '30', '6']
    const totals = new Array(titles.length).fill(0)

    this.monthData.forEach(val => {
      val.payNum.forEach((count, index) => {
        if (index < totals.length) totals[index] += Number(count) || 0
      })
    })

    return titles.map((title, index) => ({
      title,
      value: totals[index]
    }))
  }
}

export async function renderImg (data) {
  const htmlData = new HtmlData(data)
  const imgDatas = {
    ...htmlData.screenData,
    topData: htmlData.getTopData(),
    barData: JSON.stringify(htmlData.getBarData()),
    pieData: JSON.stringify(htmlData.getPieData()),
    saveId: htmlData.uid,
    uid: htmlData.uid
  }

  return await puppeteer.screenshot('srPayLog', imgDatas)
}
