import { useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { CONTRACT_TYPES, initials } from '../../lib/employeeFile'
import { uploadStaffFile } from '../../lib/employeeFileApi'
import { shrinkImage } from '../../lib/drinkPhoto'
import { errText } from '../../lib/errText'

/** One employee's file: photo, contact, contract, pay and conditions, profile. Saves through the Staff page. */
export default function EmployeeFile({ form, setForm, urls, busy, onSave, onCancel, profileFields }) {
  const { t } = useI18n()
  const [upBusy, setUpBusy] = useState('')
  const [upErr, setUpErr] = useState('')
  const [preview, setPreview] = useState({})
  const set = patch => setForm({ ...form, ...patch })

  async function upload(kind, file) {
    if (!file) return
    setUpErr('')
    setUpBusy(kind)
    try {
      const body = kind === 'foto' ? await shrinkImage(file, 480) : file
      const blob = body instanceof Blob && !body.type && kind === 'foto' ? new Blob([body], { type: 'image/jpeg' }) : body
      const path = await uploadStaffFile({ file: blob, kind, personId: form.id || 'new' })
      if (kind === 'foto') {
        setPreview(p => ({ ...p, [path]: URL.createObjectURL(blob) }))
        set({ foto: path })
      } else {
        set({ contrato_doc: path, contrato_doc_nome: file.name || 'contract' })
      }
    } catch (e) {
      setUpErr(errText(e, t('staffFile.uploadFailed')))
    } finally {
      setUpBusy('')
    }
  }

  const photo = form.foto ? (preview[form.foto] || urls[form.foto]) : ''

  return (
    <div className="house-editor staff-file">
      <div className="staff-file-head house-span">
        <label className="staff-photo" title={t('staffFile.photo')}>
          {photo ? <img src={photo} alt="" /> : <span>{initials(form.nome)}</span>}
          <input type="file" accept="image/*" hidden onChange={e => upload('foto', e.target.files?.[0])} />
          <em>{upBusy === 'foto' ? t('common.wait') : t('staffFile.changePhoto')}</em>
        </label>
        <label className="staff-file-name">{t('house.name')}<input value={form.nome} onChange={e => set({ nome: e.target.value })} /></label>
      </div>

      <h3 className="house-span">{t('staffFile.contact')}</h3>
      <label>{t('house.phone')}<input value={form.contato || ''} onChange={e => set({ contato: e.target.value })} /></label>
      <label>{t('staffFile.email')}<input type="email" value={form.email || ''} onChange={e => set({ email: e.target.value })} /></label>
      <label className="house-span">{t('staffFile.address')}<input value={form.endereco || ''} onChange={e => set({ endereco: e.target.value })} /></label>
      <label>{t('house.birthday')}<input type="date" value={form.aniversario || ''} onChange={e => set({ aniversario: e.target.value })} /></label>

      <h3 className="house-span">{t('staffFile.contract')}</h3>
      <label>{t('staffFile.contractType')}
        <select value={form.contrato_tipo || ''} onChange={e => set({ contrato_tipo: e.target.value })}>
          <option value="">—</option>
          {CONTRACT_TYPES.map(k => <option key={k} value={k}>{t(`staffFile.type.${k}`)}</option>)}
        </select>
      </label>
      <label>{t('staffFile.start')}<input type="date" value={form.contrato_inicio || ''} onChange={e => set({ contrato_inicio: e.target.value })} /></label>
      <label>{t('staffFile.end')}<input type="date" value={form.contrato_fim || ''} onChange={e => set({ contrato_fim: e.target.value })} /></label>
      <label className="staff-doc">{t('staffFile.document')}
        <span className="staff-doc-row">
          {form.contrato_doc && urls[form.contrato_doc]
            ? <a href={urls[form.contrato_doc]} target="_blank" rel="noreferrer">{form.contrato_doc_nome || t('staffFile.openDoc')}</a>
            : <em>{form.contrato_doc ? (form.contrato_doc_nome || t('staffFile.saved')) : t('staffFile.noDoc')}</em>}
          <span className="house-text staff-doc-pick">
            {upBusy === 'contrato' ? t('common.wait') : t('staffFile.attach')}
            <input type="file" accept="application/pdf,image/*" hidden onChange={e => upload('contrato', e.target.files?.[0])} />
          </span>
        </span>
      </label>

      <h3 className="house-span">{t('staffFile.pay')}</h3>
      <label>{t('house.hourly')}<input type="number" min="0" value={form.salario_hora} onChange={e => set({ salario_hora: e.target.value })} /></label>
      <label>{t('house.monthly')}<input type="number" min="0" value={form.salario_mes} onChange={e => set({ salario_mes: e.target.value })} /></label>
      <label>{t('staffFile.transport')}<input type="number" min="0" value={form.transporte || ''} onChange={e => set({ transporte: e.target.value })} /></label>
      <label>{t('staffFile.bank')}<input value={form.banco || ''} onChange={e => set({ banco: e.target.value })} /></label>
      <label className="house-check">
        <input type="checkbox" checked={!!form.drink_back} onChange={e => set({ drink_back: e.target.checked })} />
        {t('house.drinkYes')}
      </label>
      {form.drink_back && (
        <label>{t('house.commission')}<input type="number" min="0" max="100" value={form.comissao_pct} onChange={e => set({ comissao_pct: e.target.value })} /></label>
      )}
      <label className="house-span">{t('staffFile.conditions')}
        <textarea rows={3} value={form.condicoes || ''} placeholder={t('staffFile.conditionsHint')} onChange={e => set({ condicoes: e.target.value })} />
      </label>

      <h3 className="house-span">{t('staffFile.profile')}</h3>
      {profileFields}
      <label className="house-span">{t('house.notes')}<input value={form.notas || ''} onChange={e => set({ notas: e.target.value })} /></label>

      {upErr && <div className="pos-sale-err house-span">{upErr}</div>}
      <div className="house-actions house-span">
        <button type="button" className="btn-primary" disabled={busy || !!upBusy || !form.nome.trim()} onClick={onSave}>{busy ? t('common.wait') : t('house.save')}</button>
        <button type="button" className="house-text" onClick={onCancel}>{t('house.cancel')}</button>
      </div>
    </div>
  )
}
