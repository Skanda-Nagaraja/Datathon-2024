'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { PlusCircle, Trash2, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import {
    createChart,
    IChartApi,
    CrosshairMode,
    SeriesMarker,
    Time,
} from 'lightweight-charts'

// Type Definitions
type Condition = {
    indicator: string
    period: number
    comparison: string
    reference?: string
    value?: number
}

type BacktestParams = {
    ticker: string
    start_date: string
    end_date: string
    params: {
        conditions: Condition[]
        exits: Condition[]
        fixed_cash_per_trade: number
    }
    initial_cash: number
    commission: number
}

type PriceDataItem = {
    date: string
    open: number
    high: number
    low: number
    close: number
}

type TradeHistoryEntry = {
    Duration: number
    EntryBar: number
    EntryPrice: number
    EntryTime: string
    ExitBar: number
    ExitPrice: number
    ExitTime: string
    PnL: number
    ReturnPct: number
    Size: number
}

export default function BacktestingApp() {
    // State Definitions
    const [backtestParams, setBacktestParams] = useState<BacktestParams>({
        ticker: "AAPL",
        start_date: "2019-01-01",
        end_date: "2023-12-31",
        params: {
            conditions: [
                { indicator: "SMA", period: 20, comparison: ">", reference: "SMA_50" },
                { indicator: "RSI", period: 14, comparison: "<", value: 30 }
            ],
            exits: [
                { indicator: "SMA", period: 20, comparison: "<", reference: "SMA_50" },
                { indicator: "RSI", period: 14, comparison: ">", value: 70 }
            ],
            fixed_cash_per_trade: 0
        },
        initial_cash: 10000,
        commission: 0.002
    })

    const [backtestResults, setBacktestResults] = useState<{
        max_drawdown: string | number
        profit_factor: number
        sharpe_ratio: number
        total_return: number
        trade_history: TradeHistoryEntry[]
        win_rate: number
    }>({
        max_drawdown: 'N/A',
        profit_factor: NaN,
        sharpe_ratio: NaN,
        total_return: NaN,
        trade_history: [],
        win_rate: NaN,
    })

    const chartContainerRef = useRef<HTMLDivElement | null>(null)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const { theme, setTheme } = useTheme()

    // Retrieve Backend API URL from Environment Variables
    const BACKEND_API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL || ''

    useEffect(() => {
        let chart: IChartApi | null = null

        const fetchDataAndRenderChart = async () => {
            if (chartContainerRef.current && backtestParams.ticker && backtestParams.start_date && backtestParams.end_date) {
                try {
                    console.log("Initializing chart...")
                    chart = createChart(chartContainerRef.current, {
                        width: chartContainerRef.current.clientWidth,
                        height: 600,
                        layout: {
                            background: { color: theme === 'dark' ? '#000000' : '#FFFFFF' },
                            textColor: theme === 'dark' ? '#E5E7EB' : '#1F2937',
                        },
                        grid: {
                            vertLines: { color: theme === 'dark' ? '#374151' : '#E5E7EB' },
                            horzLines: { color: theme === 'dark' ? '#374151' : '#E5E7EB' },
                        },
                        crosshair: { mode: CrosshairMode.Normal },
                        timeScale: { timeVisible: true, secondsVisible: false },
                    })

                    const candleSeries = chart.addCandlestickSeries({
                        upColor: '#22C55E',
                        downColor: '#EF4444',
                        borderUpColor: '#22C55E',
                        borderDownColor: '#EF4444',
                        wickUpColor: '#22C55E',
                        wickDownColor: '#EF4444',
                    })

                    // Fetch Price Data
                    const priceDataUrl = `${BACKEND_API_URL}/get-price-data?ticker=${encodeURIComponent(backtestParams.ticker)}&start_date=${encodeURIComponent(backtestParams.start_date)}&end_date=${encodeURIComponent(backtestParams.end_date)}`
                    console.log('Fetching price data from:', priceDataUrl)

                    const priceResponse = await fetch(priceDataUrl)
                    if (!priceResponse.ok) {
                        const errorData = await priceResponse.json()
                        throw new Error(errorData.error || 'Error fetching price data')
                        console.log('Error fetching price data:', errorData)
                    }

                    const priceData: PriceDataItem[] = await priceResponse.json()
                    console.log('Received price data:', priceData)

                    if (priceData.length === 0) {
                        throw new Error('No price data available for the selected ticker and date range.')
                        console.log('No price data available for the selected ticker and date range.')
                    }

                    const formattedPriceData = priceData.map((item: PriceDataItem) => ({
                        time: item.date as Time,
                        open: item.open,
                        high: item.high,
                        low: item.low,
                        close: item.close,
                    }))

                    candleSeries.setData(formattedPriceData)

                    // Fetch and Render Indicators
                    const uniqueIndicators = Array.from(new Set(backtestParams.params.conditions.map(cond => `${cond.indicator}_${cond.period}`)))
                    const indicators = uniqueIndicators.map(ind => {
                        const [indicator, period] = ind.split('_')
                        return { indicator, period: parseInt(period) }
                    })

                    const indicatorColors: { [key: string]: string } = {
                        "SMA": "blue",
                        "EMA": "green",
                        "RSI": "purple",
                        "ATR": "orange",
                        "CCI": "brown",
                        "CMF": "cyan",
                        "Williams %R": "magenta",
                        "Donchian Channels": "pink",
                        "Parabolic SAR": "yellow",
                        "MACD": "red",
                    }

                    for (const { indicator, period } of indicators) {
                        const indicatorUrl = `${BACKEND_API_URL}/get-indicator-data?ticker=${encodeURIComponent(backtestParams.ticker)}&indicator=${encodeURIComponent(indicator)}&period=${period}&start_date=${encodeURIComponent(backtestParams.start_date)}&end_date=${encodeURIComponent(backtestParams.end_date)}`
                        console.log(`Fetching ${indicator} data from:`, indicatorUrl)

                        const indicatorResponse = await fetch(indicatorUrl)
                        if (!indicatorResponse.ok) {
                            const errorData = await indicatorResponse.json()
                            throw new Error(errorData.error || `Error fetching ${indicator} data`)
                        }

                        const indicatorData = await indicatorResponse.json()
                        console.log(`Received ${indicator} data:`, indicatorData)

                        const color = indicatorColors[indicator] || "gray"

                        const indicatorSeries = chart.addLineSeries({
                            color: color,
                            lineWidth: 1,
                        })

                        const formattedIndicatorData = indicatorData.map((item: { Date?: string, date?: string, value: number }) => {
                            const dateString = item.Date || item.date
                            if (!dateString) {
                                console.error("Error: Missing date in indicator data", item)
                                console.log("Error: Missing date in indicator data", item)
                                return null
                            }

                            const dateObj = new Date(dateString)
                            if (isNaN(dateObj.getTime())) {
                                console.error("Error: Invalid date in indicator data", item)
                                console.log("Error: Invalid date in indicator data", item)
                                return null
                            }

                            return {
                                time: Math.floor(dateObj.getTime() / 1000) as Time,
                                value: item.value,
                            }
                        }).filter(Boolean) as { time: Time, value: number }[]

                        indicatorSeries.setData(formattedIndicatorData)
                    }

                    // Render Trade History Markers
                    if (backtestResults.trade_history && backtestResults.trade_history.length > 0) {
                        const markers: SeriesMarker<Time>[] = backtestResults.trade_history.flatMap((trade: TradeHistoryEntry) => {
                            const entryDate = new Date(trade.EntryTime).toISOString().split('T')[0]
                            const exitDate = trade.ExitTime ? new Date(trade.ExitTime).toISOString().split('T')[0] : null

                            console.log("Formatted ENTRY TIME:", entryDate)
                            console.log("Formatted EXIT TIME:", exitDate)

                            const markersList: SeriesMarker<Time>[] = [
                                { time: entryDate as Time, position: 'belowBar', color: 'green', shape: 'arrowUp', text: `Buy @ ${trade.EntryPrice.toFixed(2)}` }
                            ]

                            if (exitDate) {
                                markersList.push({ time: exitDate as Time, position: 'aboveBar', color: 'red', shape: 'arrowDown', text: `Sell @ ${trade.ExitPrice.toFixed(2)}` })
                            }

                            return markersList
                        })

                        candleSeries.setMarkers(markers)
                    }

                    // Fit Chart to Content
                    chart.timeScale().fitContent()
                } catch (error) {
                    console.error('Error fetching or rendering price data:', error)
                    setFetchError((error as Error).message || 'Error fetching price data')
                }
            } else {
                console.log('Chart container or backtest parameters not set.')
            }
        }

        fetchDataAndRenderChart()

        // Cleanup Chart on Component Unmount
        return () => {
            if (chart) {
                chart.remove()
            }
        }
    }, [backtestResults, backtestParams, theme, BACKEND_API_URL])

    // Function to Update Conditions
    const updateCondition = (
        index: number,
        field: keyof Condition,
        value: string | number,
        isExit: boolean
    ) => {
        const paramType = isExit ? 'exits' : 'conditions'
        setBacktestParams((prev) => ({
            ...prev,
            params: {
                ...prev.params,
                [paramType]: prev.params[paramType].map((condition, i) =>
                    i === index ? { ...condition, [field]: value } : condition
                ),
            },
        }))
    }

    // Function to Add a New Condition
    const addCondition = (isExit: boolean) => {
        const paramType = isExit ? 'exits' : 'conditions'
        setBacktestParams((prev) => ({
            ...prev,
            params: {
                ...prev.params,
                [paramType]: [
                    ...prev.params[paramType],
                    { indicator: '', period: 0, comparison: '', reference: '' },
                ],
            },
        }))
    }

    // Function to Remove a Condition
    const removeCondition = (index: number, isExit: boolean) => {
        const paramType = isExit ? 'exits' : 'conditions'
        setBacktestParams((prev) => ({
            ...prev,
            params: {
                ...prev.params,
                [paramType]: prev.params[paramType].filter((_, i) => i !== index),
            },
        }))
    }

    // Loading and Error States
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Function to Handle Backtest Execution
    const handleBacktest = async () => {
        console.log('Backtest parameters:', backtestParams)
        setLoading(true)
        setError(null)

        // Input Validation
        if (!backtestParams.ticker || !backtestParams.start_date || !backtestParams.end_date) {
            setError('Please enter the ticker, start date, and end date.')
            setLoading(false)
            return
        }

        if (
            backtestParams.params.conditions.length === 0 ||
            backtestParams.params.exits.length === 0
        ) {
            setError('Please add at least one entry and one exit condition.')
            setLoading(false)
            return
        }

        try {
            const backtestUrl = `${BACKEND_API_URL}/run-backtest`
            console.log('Sending backtest request to:', backtestUrl)

            const response = await fetch(backtestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(backtestParams),
            })

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.error || 'Error running backtest')
            }

            const data = await response.json()
            console.log('Backtest results:', data)
            setBacktestResults(data)
            setFetchError(null)
        } catch (err) {
            console.error('Error running backtest:', err)
            setError((err as Error).message)
        } finally {
            setLoading(false)
        }
    }

    // Function to Render Condition Inputs
    const renderConditionInputs = (
        condition: Condition,
        index: number,
        isExit: boolean
    ) => (
        <div
            key={index}
            className="space-y-2 p-4 bg-gray-50 dark:bg-black rounded-lg"
        >
            <div className="flex justify-between items-center">
                <Label>
                    {isExit ? 'Exit Condition' : 'Entry Condition'} {index + 1}
                </Label>
                <Button variant="ghost" size="icon" onClick={() => removeCondition(index, isExit)}>
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
            <div className="space-y-2">
                <Select
                    value={condition.indicator}
                    onValueChange={(value) =>
                        updateCondition(index, 'indicator', value, isExit)
                    }
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select indicator" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="SMA">Simple Moving Average (SMA)</SelectItem>
                        <SelectItem value="EMA">Exponential Moving Average (EMA)</SelectItem>
                        <SelectItem value="RSI">Relative Strength Index (RSI)</SelectItem>
                        <SelectItem value="ATR">Average True Range (ATR)</SelectItem>
                        <SelectItem value="CMF">Chaikin Money Flow (CMF)</SelectItem>
                        <SelectItem value="Williams %R">Williams %R</SelectItem>
                        <SelectItem value="CCI">Commodity Channel Index (CCI)</SelectItem>
                    </SelectContent>
                </Select>
                <Input
                    type="number"
                    placeholder="Period"
                    value={condition.period || ''}
                    onChange={(e) =>
                        updateCondition(
                            index,
                            'period',
                            parseInt(e.target.value) || 0,
                            isExit
                        )
                    }
                />
                <Select
                    value={condition.comparison}
                    onValueChange={(value) =>
                        updateCondition(index, 'comparison', value, isExit)
                    }
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select comparison" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value=">">&gt;</SelectItem>
                        <SelectItem value="<">&lt;</SelectItem>
                        <SelectItem value="=">=</SelectItem>
                    </SelectContent>
                </Select>
                {condition.indicator !== 'SMA' && condition.indicator !== 'EMA' ? (
                    <Input
                        type="number"
                        placeholder="Value"
                        value={condition.value || ''}
                        onChange={(e) =>
                            updateCondition(
                                index,
                                'value',
                                parseFloat(e.target.value) || 0,
                                isExit
                            )
                        }
                    />
                ) : (
                    <Input
                        type="text"
                        placeholder="Reference (e.g., SMA_50)"
                        value={condition.reference || ''}
                        onChange={(e) => updateCondition(index, 'reference', e.target.value, isExit)}
                    />
                )}
            </div>
        </div>
    )

    const totalTrades = backtestResults.trade_history.length

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black p-4">
            {/* Header with Title and Theme Toggle */}
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-200 text-center w-full">
                    QuantWise | Smarter Trades Through Data-Driven Backtesting
                </h1>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    className="rounded-full"
                >
                    {theme === 'dark' ? (
                        <Sun className="h-[1.2rem] w-[1.2rem]" />
                    ) : (
                        <Moon className="h-[1.2rem] w-[1.2rem]" />
                    )}
                    <span className="sr-only">Toggle theme</span>
                </Button>
            </div>

            {/* Main Grid Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Section: Backtest Parameters and Results */}
                <div className="lg:col-span-2 space-y-2">
                    {/* Backtest Parameters Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Backtest Parameters</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <form className="space-y-4">
                                {/* Ticker and Initial Cash Inputs */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="ticker">Ticker</Label>
                                        <Input
                                            id="ticker"
                                            value={backtestParams.ticker}
                                            onChange={(e) =>
                                                setBacktestParams((prev) => ({
                                                    ...prev,
                                                    ticker: e.target.value,
                                                }))
                                            }
                                            placeholder="e.g., AAPL"
                                        />
                                    </div>
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="initial_cash">Initial Cash</Label>
                                        <Input
                                            id="initial_cash"
                                            type="number"
                                            value={backtestParams.initial_cash}
                                            onChange={(e) =>
                                                setBacktestParams((prev) => ({
                                                    ...prev,
                                                    initial_cash: parseFloat(e.target.value) || 0,
                                                }))
                                            }
                                            placeholder="e.g., 10000"
                                        />
                                    </div>
                                </div>

                                {/* Start and End Date Inputs */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="start_date">Start Date</Label>
                                        <Input
                                            id="start_date"
                                            type="date"
                                            value={backtestParams.start_date}
                                            onChange={(e) =>
                                                setBacktestParams((prev) => ({
                                                    ...prev,
                                                    start_date: e.target.value,
                                                }))
                                            }
                                        />
                                    </div>
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="end_date">End Date</Label>
                                        <Input
                                            id="end_date"
                                            type="date"
                                            value={backtestParams.end_date}
                                            onChange={(e) =>
                                                setBacktestParams((prev) => ({
                                                    ...prev,
                                                    end_date: e.target.value,
                                                }))
                                            }
                                        />
                                    </div>
                                </div>

                                {/* Commission and Fixed Cash Position Size Inputs */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="commission">Commission</Label>
                                        <Input
                                            id="commission"
                                            type="number"
                                            step="0.001"
                                            value={backtestParams.commission}
                                            onChange={(e) =>
                                                setBacktestParams((prev) => ({
                                                    ...prev,
                                                    commission: parseFloat(e.target.value) || 0,
                                                }))
                                            }
                                            placeholder="e.g., 0.002"
                                        />
                                    </div>
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="fixed_cash_per_trade">Fixed Cash Position Size</Label>
                                        <Input
                                            id="fixed_cash_per_trade"
                                            type="number"
                                            value={backtestParams.params.fixed_cash_per_trade}
                                            onChange={(e) =>
                                                setBacktestParams((prev) => ({
                                                    ...prev,
                                                    params: {
                                                        ...prev.params,
                                                        fixed_cash_per_trade: parseFloat(e.target.value) || 0,
                                                    },
                                                }))
                                            }
                                            placeholder="e.g., 0 to use all cash or set a fixed amount"
                                        />
                                        <small className="text-gray-500 dark:text-gray-400">
                                            Leave at 0 to use all cash for each trade
                                        </small>
                                    </div>
                                </div>
                            </form>
                        </CardContent>
                    </Card>

                    {/* Chart and Backtest Statistics */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Price Chart Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Price Chart</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div
                                    ref={chartContainerRef}
                                    id="tradingview_chart"
                                    className="w-full h-[600px]"
                                ></div>
                                {/* {fetchError && (
                                    
                                    <p className="text-red-500 text-center mt-2">{fetchError}</p>
                                )} */}
                            </CardContent>
                        </Card>

                        {/* Backtesting Statistics Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Backtesting Statistics</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                    <div className="text-center">
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Total Trades</p>
                                        <p className="text-2xl font-bold">
                                            {isNaN(totalTrades) ? 'N/A' : totalTrades}
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Win Rate</p>
                                        <p className="text-2xl font-bold">
                                            {isNaN(backtestResults.win_rate)
                                                ? 'N/A'
                                                : `${backtestResults.win_rate.toFixed(2)}%`}
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Profit Factor</p>
                                        <p className="text-2xl font-bold">
                                            {isNaN(backtestResults.profit_factor)
                                                ? 'N/A'
                                                : backtestResults.profit_factor.toFixed(2)}
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Sharpe Ratio</p>
                                        <p className="text-2xl font-bold">
                                            {isNaN(backtestResults.sharpe_ratio)
                                                ? 'N/A'
                                                : backtestResults.sharpe_ratio.toFixed(2)}
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Max Drawdown</p>
                                        <p className="text-2xl font-bold">
                                            {typeof backtestResults.max_drawdown === 'number'
                                                ? `${backtestResults.max_drawdown.toFixed(2)}%`
                                                : backtestResults.max_drawdown}
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Total Return Card */}
                        <Card className="mt-4">
                            <CardHeader>
                                <CardTitle>Total Return</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-center">
                                    <p className="text-4xl font-bold text-primary">
                                        {isNaN(backtestResults.total_return)
                                            ? 'N/A'
                                            : `${backtestResults.total_return.toFixed(2)}%`}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Right Section: Conditions Configuration */}
                <div className="lg:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle>Conditions</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <form className="space-y-4">
                                {/* Entry Conditions */}
                                <div className="space-y-2">
                                    <Label>Entry Conditions</Label>
                                    {backtestParams.params.conditions.map((condition, index) =>
                                        renderConditionInputs(condition, index, false)
                                    )}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => addCondition(false)}
                                    >
                                        <PlusCircle className="mr-2 h-4 w-4" /> Add Entry Condition
                                    </Button>
                                </div>

                                {/* Exit Conditions */}
                                <div className="space-y-2">
                                    <Label>Exit Conditions</Label>
                                    {backtestParams.params.exits.map((exit, index) =>
                                        renderConditionInputs(exit, index, true)
                                    )}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => addCondition(true)}
                                    >
                                        <PlusCircle className="mr-2 h-4 w-4" /> Add Exit Condition
                                    </Button>
                                </div>

                                {/* Run Backtest Button */}
                                <Button type="button" className="w-full" onClick={handleBacktest} disabled={loading}>
                                    {loading ? 'Running Backtest...' : 'Run Backtest'}
                                </Button>

                                {/* Error Message */}
                                {/* {error && <p className="text-red-500 text-center">{error}</p>} */}
                            </form>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
