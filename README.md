# Demo Trader

Ez a projekt egy demo célú, Firestore-alapú, Cloud Run Jobbal futtatott kereskedési rendszer. A célja nem az, hogy egy-egy nagy találattal termeljen, hanem hogy szűrtebb belépésekkel, kontrollált kockázat mellett, kisebb és következetesebb eredményeket próbáljon elérni.

## Strategy módok

A bot két külön stratégiamódot támogat:

- `strategyMode: "trend"`: az eddigi egy instrumentumos trend/pullback stratégia. Ez az alapértelmezett mód.
- `strategyMode: "pairs"`: statisztikai arbitrázs / pairs trading mód két korrelált instrumentumra, például `BTCUSDT` és `ETHUSDT`.

## Trend stratégia

Az algoritmus alapvetően trend-követő logikát használ, nem egyszerű mean reversion modellt. Ez azt jelenti, hogy nem vakon akar fordulatokat elkapni, hanem azt keresi, amikor:

- van egy értelmezhető rövid távú trend,
- a momentum támogatja az irányt,
- a piac nem túl zajos,
- és az ár nem teljesen kifutott állapotban van, hanem még vállalható beszállót ad.

Gyakorlatban a rendszer `LONG` vagy `SHORT` irányba csak akkor lép, ha több feltétel egyszerre teljesül.

## Belépési logika trader szemmel

Az algoritmus minden ciklusban friss piaci adatot kér le, majd a közelmúltbeli ármozgásból több szűrőt épít.

- Trendszűrés: gyors és lassú EMA alapján dönti el, hogy inkább long vagy short oldalra érdemes-e egyáltalán gondolkodni.
- Trend-erősség: csak akkor keres belépőt, ha a gyors és lassú EMA közti távolság elég nagy. Ezzel a lapos, iránytalan piac egy részét kiszűri.
- Momentum: nem elég, hogy a trend irányba áll, kell hozzá friss és középtávú lendület is.
- Volatilitás-szűrés: ha a rövid távú szórás túl nagy, akkor a rendszer inkább nem nyit, mert az ilyen környezetben könnyebben kiszedi a stopot.
- Pullback/range pozíció: a belépő nem akkor ideális, amikor az ár már teljesen kifeszített. A logika figyeli, hogy a közelmúlt lokális sávján belül hol áll az ár, és a túlságosan "kifutott" helyzeteket próbálja elkerülni.
- RSI-szűrés: a cél itt nem klasszikus túlvett/túladott fordulóvadászat, hanem annak ellenőrzése, hogy a trend oldala még egészséges-e.

Röviden: a rendszer inkább megerősített trendet keres, és azon belül próbál jobb beszállót találni, nem pedig minden hirtelen mozgást lekereskedni.

## Pozíciókezelés

A stratégia erejének nagy része nem csak a belépőben, hanem a pozíció kezelésében van.

- Kockázatalapú méretezés: a kötésméret a számlaegyenleghez, a stop távolságához és a maximális margin korláthoz igazodik.
- Fix kezdeti stop-loss: minden trade azonnal kap stopot.
- Fix kezdeti take-profit: az induló célár az induló kockázat többszöröse.
- Break-even védelem: ha a trade elér egy bizonyos `R` nyereséget, a stop feljebb vagy lejjebb húzódik a belépő fölé/alá, hogy a jó trade ne forduljon vissza teljes veszteségbe.
- Trailing stop: ha a mozgás tovább fut, a rendszer a legjobb elért ár alapján dinamikusan húzza a stopot.
- Trend flip exit: ha a pozíció már nyereségben van, de a piac újraértékelve az ellenoldalra állna, a rendszer zárhatja a kötést.
- Time exit: ha a trade túl sok ciklusig bent ragad, és nem teljesen rossz helyzetben van, a rendszer lezárhatja, hogy felszabadítsa a tőkét.
- Likvidációs védelem: futures módban számolt likvidációs szint is van, hogy a demo eredmények reálisabban modellezzék a tőkeáttételes kitettséget.

Trader szempontból ez azt jelenti, hogy a rendszer nem csak "belép és reménykedik", hanem aktívan próbálja védeni a nyitott profitot és gyorsabban levágni a romló setupokat.

## Költségek és piaci súrlódás kezelése

A stratégia számol a következőkkel:

- kötési díj (`feeBps`),
- slippage (`slipBps`),
- futures funding buffer (`fundingBufferBps`).

Ez azért fontos, mert egy papíron szép, de költségérzéketlen stratégia a valóságban könnyen veszteségessé válik. A rendszer belépési küszöbei ezért nem csak nyers ármozgáshoz, hanem becsült round-trip költséghez is igazodnak.

## ML szűrő szerepe

Az algoritmusban van egy könnyűsúlyú online ML szűrő is.

- Több rövid távú feature-ből dolgozik, például hozamokból, volatilitásból, EMA-különbségből, RSI-ből és range pozícióból.
- Logisztikus regressziót használ.
- Folyamatosan, online módon tanul az új ármozgásokból.
- Nem önálló stratégiaként működik, hanem opcionális megerősítő rétegként.

Trader szemmel ez inkább egy plusz szűrő, nem "AI, ami önmagában kereskedik". Informatikai szempontból ez egy adaptív confidence layer, amely a klasszikus szabályalapú logika fölött ül.

Megjegyzés: backtestnél rövidebb historikus mintákon az ML szűrő gyakran túlságosan visszafogja a kereskedéseket, ezért a CLI backtest alapból `useMlFilter=false` beállítással fut, hacsak ez nincs külön felülírva. Pairs módban az ML nem döntéshozó, csak opcionális setup scorer lehet; a páros stratégia önmagában, szabályalapon is működik.

## Pairs trading stratégia

Pairs módban a bot két árfolyamot tart nyilván:

- `baseSymbol`, alapból `BTCUSDT`
- `quoteSymbol`, alapból `ETHUSDT`

A stratégia gördülő ablakon számolja a két instrumentum hozamkorrelációját, a beta hedge becslést, a spread átlagát/szórását és a z-score-t. A spread definíciója log módban:

```text
logSpread = log(quotePrice) - beta * log(basePrice)
```

Ez alapján:

- magas z-score: a quote drága a base-hez képest, ezért a bot `SHORT quote / LONG base` párpozíciót nyit;
- alacsony z-score: a quote olcsó a base-hez képest, ezért `LONG quote / SHORT base` párpozíciót nyit.

A belépéshez teljesülnie kell a minimum korrelációnak, a half-life szűrőnek ha számolható, és a z-score-nak a `pairEntryZScore` és `pairMaxEntryZScore` közötti sávban kell lennie. A kilépés mean reversion esetén `pairExitZScore` alatt történik, stop pedig `pairStopZScore`, korrelációromlás, időlimit vagy risk budget sérülés miatt lehet.

Példa config:

```json
{
  "strategyMode": "pairs",
  "baseSymbol": "BTCUSDT",
  "quoteSymbol": "ETHUSDT",
  "pairLookbackBars": 120,
  "pairMinCorrelation": 0.65,
  "pairEntryZScore": 2.0,
  "pairMaxEntryZScore": 2.8,
  "pairExitZScore": 0.4,
  "pairStopZScore": 3.2,
  "pairHedgeMode": "beta",
  "pairRiskPerTradePct": 0.5,
  "pairMaxGrossExposurePct": 30,
  "useMlFilter": false
}
```

## Informatikai megvalósítás

Folyamat szinten a rendszer így működik:

1. A Cloud Scheduler elindítja a Cloud Run Jobot.
2. A worker lefuttat pontosan egy trading ciklust.
3. A ciklus betölti a Firestore `config`, `state`, `history` dokumentumokat.
4. Lekéri az aktuális piaci adatot.
5. Frissíti a price series-t, az ML állapotot és a funding elszámolást.
6. Kezeli a meglévő pozíciót, ha van.
7. Ha nincs pozíció, új belépőt keres.
8. Elmenti a módosított állapotot Firestore-ba.

Ez a felépítés azért jó, mert az algoritmus determinisztikus ciklusokban dolgozik, nem kell folyamatosan futó processzt menedzselni, és a teljes runtime állapot visszaolvasható Firestore-ból.

## Főbb paraméterek

Néhány fontosabb hangolható mező:

- `thresholdPct`: a minimális elvárt elmozdulás alapja.
- `thresholdCostMultiplier`: mennyire legyen szigorú a belépési küszöb a költségekhez képest.
- `riskPerTradePct`: a számla mekkora része kockáztatható egy trade-ben.
- `maxMarginPct`: maximális felhasználható margin.
- `stopLossPct`: kezdeti stop távolság százalékban.
- `takeProfitRR`: kezdeti risk-reward arány.
- `trendFastBars`, `trendSlowBars`: trenddetektálás érzékenysége.
- `momentumBars`: rövid távú lendület mérése.
- `volatilityBars`, `maxVolatilityPct`: zajszűrés.
- `breakEvenTriggerR`, `trailingStopR`: profitvédelem szabályai.
- `maxHoldCycles`: maximális bent tartási idő.
- `useMlFilter`, `mlMinConfPct`: ML megerősítés használata.
- `pairLookbackBars`, `pairMinCorrelation`: pairs statisztikai ablak és minimum korreláció.
- `pairEntryZScore`, `pairMaxEntryZScore`, `pairExitZScore`, `pairStopZScore`: pairs belépési sáv, kilépési és stop z-score küszöbök.
- `pairHedgeMode`: `beta` vagy `notional` hedge.
- `pairRiskPerTradePct`, `pairMaxGrossExposurePct`: páros pozíció kockázati és gross exposure korlátai.
- `maxDailyLossPct`, `maxWeeklyLossPct`, `maxConsecutiveLosses`, `pauseAfterDrawdownPct`: új belépéseket tiltó demo kill switch korlátok.

## Backtest és optimalizálás

A projekt tartalmaz lokális backtest és grid-search optimalizáló eszközt is.

- Sima backtest: `npm run backtest -- --data ./data/prices.json`
- Optimalizálás: `npm run backtest -- --data ./data/prices.json --optimize --top 5`
- Pair backtest: `npm run backtest -- --data ./data/pair-prices.csv --set-strategyMode pairs --set-baseSymbol BTCUSDT --set-quoteSymbol ETHUSDT`
- Pair optimalizálás: `npm run backtest -- --data ./data/pair-prices.csv --set-strategyMode pairs --optimize`
- Walk-forward mód: `npm run backtest -- --data ./data/pair-prices.csv --strategy pairs --walk-forward`

Régi single-symbol JSON formátum:

```json
[100, 101, 102]
```

vagy:

```json
[
  { "price": 65000, "fundingRate": 0.0001, "ts": 1710000000000 }
]
```

Pair JSON formátum:

```json
[
  {
    "ts": 1710000000000,
    "basePrice": 65000,
    "quotePrice": 3200,
    "fundingRateBase": 0.0001,
    "fundingRateQuote": 0.0001
  }
]
```

Pair CSV fejléc:

```csv
ts,basePrice,quotePrice,fundingRateBase,fundingRateQuote
1710000000000,65000,3200,0.0001,0.0001
```

A backtest a jelenlegi stratégialogikát futtatja végig historikus adaton. Az optimalizáló több paraméterkombinációt próbál ki, majd pontozza őket profit, expectancy, win rate, profit factor, activity és drawdown alapján.

Ez nem helyettesíti a professzionális walk-forward validációt, de jó első lépés arra, hogy a stratégia ne érzésre, hanem adatok alapján legyen hangolva.

## Fontos korlátok

- Ez továbbra is demo rendszer, nem valós execution engine.
- A profit nem garantálható.
- A pairs/stat arb sem garantál profitot; a korrelációk széteshetnek, a spread tartósan elszaladhat.
- A stratégia jelenlegi állapotában BTCUSDT típusú, rövid ciklusú futures/spot demózásra van hangolva.
- A legjobb paraméterek idősíktól, instrumentumtól és piaci rezsimtől függnek.
- A backtest könnyen overfittelhet, különösen grid-search optimalizálásnál.
- Live tradinghez sokkal szigorúbb execution, monitoring, likviditási, jogi és kockázati review kellene.

## Rövid összefoglaló

Trader nézőpontból a jelenlegi algoritmus egy konzervatívabb, trend-követő, pullback-orientált rendszer, amely a belépés előtt több szűrőt is használ, és nagy hangsúlyt fektet a pozíció utólagos kezelésére.

Fejlesztői nézőpontból ez egy szabályalapú kereskedési mag, amelyet egy opcionális online ML szűrő egészít ki, Firestore-ban tartott runtime állapottal, Cloud Scheduler által indított Cloud Run Job futtatással, valamint külön backtest és paraméter-optimalizáló eszközzel.
