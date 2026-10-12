/** Strings for VIP room hours, pay-as-you-go guests, floor size/capacity and the chart type picker. */
export default {
  chart: {
    type: 'Chart type', series: 'What to show',
    kind: { columns: 'Columns', line: 'Line', bars: 'Bars', donut: 'Donut', rank: 'Ranking', pair: 'Side by side', table: 'Table' },
  },
  viph: {
    title: 'Room hours and charges',
    lead: 'Set a price per hour for each room. The till asks before every {block} block runs out ({warn} min before) whether to charge more hours or leave it free.',
    perHour: 'Price per hour', calcHours: 'Hours', other: 'Other', costFor: 'Cost for {hours}h', noPrice: 'No price per hour yet: the till will only ask to leave it free.',
    savedPrice: 'Price saved for {name}.', blocksTitle: 'Till reminder', blocksHelp: 'Length of each charge block and how many minutes before the end the till asks.',
    blockMin: 'Block (minutes)', warnMin: 'Ask before (minutes)', savedBlocks: 'Reminder saved.', notStored: 'This store did not keep the setting. Try again.',
    kOpen: 'Bar open', kOpenSub: 'Opening hours {h}:00–{c}:00', kUsed: 'VIP share of open time', kUsedSub: '{time} used in all rooms',
    kBilled: 'Hours charged', kWaived: '{time} left free', kFee: 'Paid for room hours', kSpend: '{amount} spent in the rooms in total',
    chartHours: 'Bar open × VIP hours', chartMoney: 'Money in the VIP rooms', chartRooms: 'By room', night: 'Night',
    sOpen: 'Bar open', sUsed: 'VIP used', sBilled: 'Charged', sWaived: 'Left free', sSpend: 'Spent in rooms', sFee: 'Room hours',
  },
  vipPos: {
    title: 'VIP rooms', free: 'Free · tap to start', needStart: 'Ask the first block', left: '{time} left', over: 'Over by {time}',
    openTitle: 'Start {room}', openHint: '{price} per hour. The till asks every {block}.', noPrice: 'This room has no price per hour (set it on the VIP page).',
    start: 'Start room', askStart: 'The room just started: charge the first block?', askSoon: 'Time runs out in {time}. Ask the guests: more hours?',
    askOver: 'Time ran out {time} ago. Charge more hours or leave it?', covered: '{time} left in this block.',
    sofar: 'So far: {billed} charged ({amount}), {free} left free.', chargeH: 'Charge {h}h', leave: 'Leave it, no charge', leaveSub: 'Next question in {h}h',
    end: 'Room finished', endSub: 'Guests left', later: 'Ask me in 5 min', charged: '{amount} added to the tab {tab}.',
    leftFree: '{room}: {time} left free.', ended: '{room} is free again.', alreadyDone: 'Another till already decided this block.',
  },
  walk: {
    mode: 'Pay as you go', modeHint: 'Quiet nights: each drink paid on its own, no tab. Pick the person so the till counts their drinks.',
    who: 'Who is paying', newPerson: 'New person', drinksShort: '{n} drinks', glance: 'Pay as you go', glanceHint: 'Guests tonight paying drink by drink',
    peopleN: '{n} people', drinksN: '{n} drinks',
    peopleTitle: 'New people per night', peopleLead: 'Pay-as-you-go guests (each one is a new person that night) plus customers added to the book.',
    range: 'Period', days: '{n} days', kNew: 'New people', kNewSub: '{walk} pay as you go · {crm} new in the book',
    kWalk: 'Pay as you go', kAvg: '{n} drinks per person', kDrinks: 'Their drinks',
    sNew: 'New people', sWalk: 'Pay as you go', sCrm: 'New in the book', sDrinks: 'Drinks',
  },
  floor: {
    addFun: 'Add entertainment',
    shape: { darts: 'Darts', pool: 'Pool table', karaoke: 'Karaoke', tv: 'TV / screen', arcade: 'Arcade', dj: 'DJ booth', game: 'Games', dance: 'Dance floor' },
    m: {
      title: 'Size and capacity', size: 'Real size', area: 'Floor area', furniture: 'Taken by furniture', free: 'Free floor', tables: 'Tables',
      seats: 'Seats', standing: 'Standing (estimate)', capacity: 'People in total (estimate)', perSeat: 'm² per seat',
      scale: 'Pixels per metre', perPerson: 'm² per standing guest', saved: 'Scale saved.',
      help: 'Draw the room to scale: with 50 pixels per metre a 1200 × 800 plan is 24 × 16 m. Check the legal capacity with the building rules.',
    },
  },
}
