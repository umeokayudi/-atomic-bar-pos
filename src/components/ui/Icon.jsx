import {
  LayoutDashboard, ReceiptText, ShoppingCart, Banknote, ClipboardList, Truck, PackageSearch,
  LineChart, Receipt, FileText, Wine, Store, Users, Wallet, Factory, ArrowLeftRight, BadgeJapaneseYen,
  User, CalendarDays, Clock, Target, TrendingUp, Star, NotebookPen, Award, ListChecks, Home,
  Armchair, Contact, BookOpenCheck, CalendarHeart, Sparkles, Handshake, GlassWater, CreditCard,
  Zap, Building2, Pin, ChartNoAxesCombined, Calculator, Landmark, Boxes, Library, Tags, Printer,
  Menu, Bell, Settings, Sun, Moon, Monitor, Search, X, Plus, Minus, Trash2, Copy, Save, Undo2,
  ZoomIn, ZoomOut, Maximize2, Move, Square, Circle, RectangleHorizontal, LayoutGrid, Map as MapIcon,
  Send, Bot, History, Lightbulb, Workflow, AlertTriangle, CheckCircle2, Info, ChevronRight,
  ChevronLeft, ChevronDown, Megaphone, Briefcase, Heart, Filter, RefreshCw, ImageOff, Split,
  Merge, MoveRight, HandCoins, Lock, Keyboard, LogOut, Beer, Martini, CupSoda, Flame, UtensilsCrossed,
  Grape, Brush, CalendarClock, RotateCcw, Hourglass, Pencil, Smartphone, Eye, Users as People, Wine as WineGlass,
} from 'lucide-react'

/** One name → one vector icon. Screens ask for a semantic name, never an emoji. */
const ICONS = {
  dashboard: LayoutDashboard, billingHub: ChartNoAxesCombined, purchases: ShoppingCart, sales: Banknote,
  pedidos: ClipboardList, orders: ClipboardList, fulfillment: Truck, procurement: PackageSearch,
  relatorio: LineChart, report: LineChart, ryoshusho: Receipt, seikyusho: FileText, products: Wine,
  bars: Store, usuarios: Users, users: Users, faturas: FileText, invoices: FileText, suppliers: Factory,
  cashflow: ArrowLeftRight, payroll: BadgeJapaneseYen, profile: User, shifts: CalendarDays, clock: Clock,
  goals: Target, result: TrendingUp, points: Star, occurrences: NotebookPen, rewards: Award, salary: Wallet,
  tasks: ListChecks, inicio: Home, home: Home, pos: ReceiptText, entregas: Truck, espacos: Armchair,
  mesas: LayoutGrid, floor: LayoutGrid, comandas: ClipboardList, clientes: Contact, ponto: Clock,
  fechamento: BookOpenCheck, metas: Target, pagamentos: CalendarDays, salarios: Wallet, eventos: CalendarHeart,
  ia: Sparkles, ai: Sparkles, staff: User, fornecedor: Truck, parceiro: Handshake, drinkback: GlassWater,
  cartao: CreditCard, energia: Zap, aluguel: Building2, fixo: Pin, variavel: TrendingUp, contador: Calculator,
  imposto: Landmark, estoque: Boxes, custos: Library, precos: Tags, recibos: Printer,
  marketing: Megaphone, crm: Heart, consultoria: Briefcase,
  menu: Menu, bell: Bell, settings: Settings, sun: Sun, moon: Moon, system: Monitor, search: Search,
  close: X, plus: Plus, minus: Minus, trash: Trash2, copy: Copy, save: Save, undo: Undo2,
  zoomIn: ZoomIn, zoomOut: ZoomOut, fit: Maximize2, move: Move, square: Square, circle: Circle,
  rect: RectangleHorizontal, map: MapIcon, send: Send, bot: Bot, history: History, idea: Lightbulb,
  automation: Workflow, warning: AlertTriangle, ok: CheckCircle2, info: Info, next: ChevronRight,
  back: ChevronLeft, down: ChevronDown, filter: Filter, refresh: RefreshCw, noImage: ImageOff,
  split: Split, merge: Merge, transfer: MoveRight, partialPay: HandCoins, lock: Lock, keyboard: Keyboard,
  signOut: LogOut,
  star: Star, edit: Pencil, eye: Eye, reopen: RotateCcw, people: People, phone: Smartphone,
  // table states
  stFree: CheckCircle2, stAwaitingOrder: Hourglass, stConsuming: GlassWater, stOccupied: People,
  stAwaitingPayment: HandCoins, stReserved: CalendarClock, stCleaning: Brush,
  // till tiles without a photo
  catBeer: Beer, catWine: WineGlass, catCocktail: Martini, catSoft: CupSoda, catShot: Flame, catFood: UtensilsCrossed,
  catSpirit: GlassWater, catSake: Grape,
  payCash: Banknote, payCard: CreditCard, payPhone: Smartphone,
}

export default function Icon({ name, size = 18, strokeWidth = 1.8, className = '', label, ...rest }) {
  const Cmp = ICONS[name] || Info
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      className={`ui-icon ${className}`.trim()}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  )
}

export function hasIcon(name) {
  return Boolean(ICONS[name])
}
