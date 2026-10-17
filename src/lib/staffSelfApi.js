/** Staff app calls. All go through /api/bar-staff (session-scoped on the server; no new endpoint). */
import { staffFetch } from './apiAuth'
import { errText } from './errText'

async function post(action, payload = {}) {
  const res = await staffFetch('/api/bar-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  })
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { error: text.slice(0, 160) } }
  if (!res.ok || json.error) {
    const err = new Error(errText(json.error, `Failed (${res.status})`))
    err.status = res.status
    throw err
  }
  return json
}

export const meDay = () => post('meDay')
export const meProfile = () => post('meProfile')
export const meUploadPhoto = image => post('meUploadPhoto', image)
export const meRequests = () => post('meRequests')
export const meSendRequest = req => post('meSendRequest', req)
export const meEarnings = (from, to) => post('meEarnings', { from, to })

// Owner / manager
export const listRequests = () => post('listRequests')
export const answerRequest = (id, patch) => post('answerRequest', { id, ...patch })
export const listDayReports = night => post('listDayReports', night ? { night } : {})
export const saveBarLocation = ({ lat, lng, geofence_m }) => post('saveLocation', { lat, lng, geofence_m })

// Schedule (staff marks the nights they will work; owner confirms), fines, salary payouts
export const meAvailability = () => post('meAvailability')
export const meSaveAvailability = (days, submitWeek) => post('meSaveAvailability', submitWeek ? { days, submitWeek } : { days })
export const mePayouts = () => post('mePayouts')
export const scheduleBoard = (from, to) => post('scheduleBoard', { from, to })
export const confirmSchedule = (day, people) => post('confirmSchedule', { day, people })
export const saveScheduleRules = rules => post('saveScheduleRules', rules)
export const remindSchedule = staffIds => post('remindSchedule', { staff_ids: staffIds })
export const listFines = (from, to) => post('listFines', { from, to })
export const saveFine = fine => post('saveFine', fine)
export const cancelFine = (id, note) => post('cancelFine', { id, note })
export const saveFineSettings = settings => post('saveFineSettings', settings)
export const markSalaryPaid = payout => post('markSalaryPaid', payout)
export const unmarkSalaryPaid = id => post('unmarkSalaryPaid', { id })
export const listPayouts = month => post('listPayouts', month ? { month } : {})
