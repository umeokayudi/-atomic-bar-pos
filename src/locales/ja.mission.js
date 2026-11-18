/** Missão Máxima strings (money labels, reconciliation, language, states, open tabs, offline). */
export default {
  "mm": {
    "money": {
      "faturado": "請求額",
      "recebido": "入金済み（確認済）",
      "aReceber": "未収金",
      "pendente": "確認待ち",
      "faturadoHint": "請求書の正式な合計",
      "recebidoHint": "一件ずつ確認した入金のみ",
      "aReceberHint": "請求額 − 確認済み入金",
      "pendenteHint": "支払い済みと報告されたが未確認。入金には含めません",
      "loadError": "金額を読み込めませんでした。もう一度お試しください。"
    },
    "conc": {
      "nav": "照合センター",
      "title": "照合センター",
      "sub": "合わない項目を左右に並べて表示します。ここでは金額を一切変更しません。各項目はオーナーの判断を待ちます。",
      "empty": "照合する項目はありません。領収書・請求書・入金は一致しています。",
      "loading": "領収書・請求書・入金を確認中…",
      "error": "記録を読み込めませんでした：{error}",
      "retry": "再試行",
      "diff": "差額",
      "decide": "オーナーの判断",
      "decided": "判断を記録済み",
      "decidedBy": "{who} · {when}",
      "noDecision": "オーナーの判断待ち",
      "decisionTitle": "オーナーの判断",
      "decisionHint": "決定内容を書いてください。名前と時刻つきで操作履歴に保存されます。金額は変更されません。",
      "decisionPlaceholder": "例：RY-202610-002 を有効、RY-202610-003 は再発行",
      "save": "判断を保存",
      "cancel": "キャンセル",
      "saved": "判断を保存しました",
      "saveError": "判断を保存できませんでした：{error}",
      "onlyOwner": "判断を記録できるのはオーナー（管理者）のみです",
      "kind": {
        "receipt_invoice": "領収書と請求書が一致しません",
        "receipt_duplicate": "同じ入金に領収書が2枚",
        "paid_no_row": "確認済み入金なしで「支払い済み」",
        "pending_credit": "確認待ちの入金",
        "test_item": "テスト品（一覧・合計から除外）"
      },
      "side": {
        "receipt": "領収書",
        "invoice": "請求書",
        "invoice_paid": "請求書上の支払額",
        "confirmed_rows": "確認済み入金",
        "payment": "登録された入金",
        "product": "商品"
      },
      "open": "未処理 {n} 件",
      "all": "すべて",
      "waiting": "判断待ち",
      "done": "判断済み"
    },
    "lang": {
      "title": "言語",
      "hint": "言語はアカウントごとに固定です。変更はこの画面のみ。",
      "saved": "このアカウントの言語を保存しました"
    },
    "state": {
      "loading": "読み込み中…",
      "empty": "まだ何もありません",
      "error": "問題が発生しました",
      "retry": "再試行"
    },
    "openTabsQueue": {
      "title": "未会計の伝票",
      "age": "{age} 経過",
      "from": "{date} に開始",
      "none": "未会計の伝票はありません",
      "resolve": "処理する",
      "resolveTitle": "古い伝票を処理",
      "resolveHint": "会計なしで閉じる理由を書いてください。操作履歴に残ります。",
      "days": "{n}日",
      "hours": "{n}時間",
      "minutes": "{n}分",
      "total": "未会計 {n} 件 · {amount}",
      "mustResolve": "未会計の伝票を会計または処理してから締めてください。"
    },
    "offline": {
      "queued": "{n} 件の売上をこの端末に保存中（接続待ち）",
      "syncing": "保存した売上を送信中…",
      "synced": "保存した売上を送信しました",
      "offlineNow": "接続がありません。売上はこの端末に保存し、復帰後に送信します。"
    }
  }
}
