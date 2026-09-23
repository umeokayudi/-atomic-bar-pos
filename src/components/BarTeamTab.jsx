import TimeClockPanel from './TimeClock'

/** Team lives on the People / clock page. Keep this route for old links. */
export default function BarTeamTab({ bar }) {
  return <TimeClockPanel bar={bar} />
}
