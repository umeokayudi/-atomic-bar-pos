/** VIP室の時間料金・都度払い客・フロアの広さ/定員・グラフ種類の文言。 */
export default {
  chart: {
    type: 'グラフの種類', series: '表示する値',
    kind: { columns: '縦棒', line: '折れ線', bars: '横棒', donut: 'ドーナツ', rank: 'ランキング', pair: '並べて比較', table: '表' },
  },
  viph: {
    title: '個室の時間と料金',
    lead: '個室ごとに1時間の料金を設定します。{block}ごとの区切りが終わる{warn}分前に、レジが延長料金を取るか無料にするかを聞きます。',
    perHour: '1時間の料金', calcHours: '時間', other: 'その他', costFor: '{hours}時間の料金', noPrice: '時間料金が未設定です。レジは無料延長だけを聞きます。',
    savedPrice: '{name}の料金を保存しました。', blocksTitle: 'レジの通知', blocksHelp: '1区切りの長さと、終了の何分前に聞くか。',
    blockMin: '区切り（分）', warnMin: '何分前に聞く', savedBlocks: '通知を保存しました。', notStored: '設定が保存されませんでした。もう一度お試しください。',
    kOpen: '営業時間', kOpenSub: '{h}:00–{c}:00', kUsed: '営業時間に対する個室利用', kUsedSub: '全個室で {time}',
    kBilled: '請求した時間', kWaived: '無料 {time}', kFee: '時間料金の売上', kSpend: '個室の合計 {amount}',
    chartHours: '営業時間 × 個室利用', chartMoney: '個室の売上', chartRooms: '個室別', night: '日付',
    sOpen: '営業', sUsed: '個室利用', sBilled: '請求', sWaived: '無料', sSpend: '個室の売上', sFee: '時間料金',
  },
  vipPos: {
    title: '個室', free: '空き・タップで開始', needStart: '最初の区切りを確認', left: '残り {time}', over: '{time} 超過',
    openTitle: '{room} を開始', openHint: '1時間 {price}。{block}ごとに確認します。', noPrice: 'この個室は時間料金が未設定です（個室ページで設定）。',
    start: '開始', askStart: '個室が始まりました。最初の区切りを請求しますか？', askSoon: '残り {time}。延長するかお客様に確認してください。',
    askOver: '{time} 前に時間が終わりました。延長を請求しますか？', covered: 'この区切りの残り {time}。',
    sofar: 'これまで：請求 {billed}（{amount}）、無料 {free}。', chargeH: '{h}時間 請求', leave: 'そのまま（無料）', leaveSub: '次の確認は{h}時間後',
    end: '利用終了', endSub: 'お客様が退室', later: '5分後にもう一度', charged: '{amount} を伝票 {tab} に追加しました。',
    leftFree: '{room}：{time} 無料にしました。', ended: '{room} が空きになりました。', alreadyDone: '別のレジがこの区切りを処理済みです。',
  },
  walk: {
    mode: '都度払い', modeHint: '暇な日：伝票なしで1杯ずつ会計。人を選ぶと杯数を数えます。',
    who: 'お客様', newPerson: '新しい人', drinksShort: '{n}杯', glance: '都度払い', glanceHint: '今夜1杯ずつ払っているお客様',
    peopleN: '{n}人', drinksN: '{n}杯',
    peopleTitle: '日ごとの新しいお客様', peopleLead: '都度払いのお客様（その日の新しい人）と、顧客台帳に追加された人。',
    range: '期間', days: '{n}日', kNew: '新しいお客様', kNewSub: '都度払い {walk}・台帳に新規 {crm}',
    kWalk: '都度払い', kAvg: '1人 {n}杯', kDrinks: '都度払いの杯数',
    sNew: '新しいお客様', sWalk: '都度払い', sCrm: '台帳に新規', sDrinks: '杯数',
  },
  floor: {
    addFun: 'エンタメを追加',
    shape: { darts: 'ダーツ', pool: 'ビリヤード', karaoke: 'カラオケ', tv: 'テレビ／画面', arcade: 'ゲーム機', dj: 'DJブース', game: 'ゲーム', dance: 'ダンスフロア' },
    m: {
      title: '広さと定員', size: '実寸', area: '床面積', furniture: '家具の面積', free: '空き床', tables: 'テーブル',
      seats: '席数', standing: '立ち客（目安）', capacity: '合計人数（目安）', perSeat: '1席あたりm²',
      scale: '1mのピクセル数', perPerson: '立ち客1人のm²', saved: '縮尺を保存しました。',
      help: '縮尺どおりに描いてください。1m＝50ピクセルなら 1200×800 は 24×16m です。法定定員は建物の規則で確認してください。',
    },
  },
}
