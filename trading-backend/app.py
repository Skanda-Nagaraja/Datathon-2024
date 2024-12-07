import pandas as pd
from flask import Flask, request, jsonify
from flask_cors import CORS
from backtesting import Backtest
import numpy as np
import json
from dynamic_strategy import DynamicStrategy
from data_validation import fetch_data, validate_and_clean_data
from indicators import calculate_indicators
from dotenv import load_dotenv
import os

# Load environment variables from .env file (optional, since Render manages them)
load_dotenv()

app = Flask(__name__)
allowed_origins = [
    "https://datathon-2024-bice.vercel.app",
    "https://nextjs-frontend-5cjm.onrender.com/",  
    "http://localhost:3000", 
    "http://127.0.0.1:3000"
]

CORS(app, origins=allowed_origins)

@app.route('/api/get-price-data', methods=['GET'])
def get_price_data():
    print("Received /api/get-price-data request")
    print("Request data:", request.args)
    ticker = request.args.get('ticker')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    print("Ticker:", ticker)
    print("Start Date:", start_date)
    print("End Date:", end_date)

    # Validate inputs
    if not ticker or not start_date or not end_date:
        return jsonify({'error': 'ticker, start_date, and end_date are required parameters'}), 400

    try:
        df = fetch_data(ticker, start_date, end_date)
        df.reset_index(inplace=True)
        df['Date'] = pd.to_datetime(df['Date'], errors='coerce').dt.strftime('%Y-%m-%d')

        # Flatten MultiIndex if necessary
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = ['_'.join(filter(None, col)).lower() for col in df.columns]
            print("Flattened columns:", df.columns)

        # Updated column mapping
        column_mapping = {
            'Date': 'date',
            'Open': 'open',
            'High': 'high',
            'Low': 'low',
            'Close': 'close',
            'Adj Close': 'adj_close',  # Optional
            'Volume': 'volume'         # Optional
        }
        df.rename(columns=column_mapping, inplace=True)
        print("Columns after renaming:", df.columns)

        # Convert to dictionary and check for tuple keys
        data = df[['date', 'open', 'high', 'low', 'close']].to_dict(orient='records')
        print("Formatted data:", data[:5])  # Log a sample of the data

        return jsonify(data)
    except Exception as e:
        print("Exception occurred:", e)
        return jsonify({'error': str(e)}), 400


@app.route('/api/run-backtest', methods=['POST'])
def run_backtest():
    print("Received /api/run-backtest request")
    print("Request JSON body:", json.dumps(request.json, indent=2))
    data = request.json
    print("Received data:", data)

    # Validate required inputs
    required_fields = ['ticker', 'start_date', 'end_date', 'params', 'initial_cash', 'commission']
    for field in required_fields:
        if field not in data or not data[field]:
            return jsonify({'error': f'{field} is a required parameter'}), 400

    # Step 1: Fetch and validate historical data
    try:
        df = fetch_data(data['ticker'], data['start_date'], data['end_date'])
        
        # Flatten MultiIndex if necessary
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        
        # Prioritize 'Adj Close' over 'Close'
        if 'Adj Close' in df.columns:
            df['Close'] = df['Adj Close']
            df.drop(columns=['Adj Close'], inplace=True)
        
        # Rename columns to match expected format
        column_mapping = {
            'open': 'Open',
            'high': 'High',
            'low': 'Low',
            'volume': 'Volume',
            'Open': 'Open',
            'High': 'High',
            'Low': 'Low',
            'Volume': 'Volume',
        }
        df.rename(columns=column_mapping, inplace=True)
        
        # Validate essential columns
        required_columns = {'Open', 'High', 'Low', 'Close', 'Volume'}
        if not required_columns.issubset(df.columns):
            return jsonify({"error": f"DataFrame must include {required_columns} columns"}), 400

        # Validate and clean data
        df = validate_and_clean_data(df)

    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Step 2: Calculate Required Indicators
    try:
        # Collect all required indicators from conditions and exits
        required_indicators = []
        for condition in data['params'].get('conditions', []) + data['params'].get('exits', []):
            required_indicators.append(condition)

        # Calculate only the required indicators
        df = calculate_indicators(df, required_indicators)
        print("DataFrame columns after indicator calculations:", df.columns)
        print(df.head())
        
    except Exception as e:
        print(f"Error calculating indicators: {e}")
        return jsonify({"error": f"Error calculating indicators: {e}"}), 400

    print(f"Data after indicator calculations: {len(df)} rows")

    # Step 3: Handle NaNs
    # Drop NaNs only in essential columns
    essential_columns = ['Open', 'High', 'Low', 'Close', 'Volume']
    df.dropna(subset=essential_columns, inplace=True)

    # Optionally fill NaNs in indicator columns
    df.fillna(method='ffill', inplace=True)
    df.fillna(method='bfill', inplace=True)

    print(f"Data after handling NaNs: {len(df)} rows")

    if df.empty:
        return jsonify({"error": "No data available after processing. Please adjust your date range or check your indicators."}), 400

    # Step 4: Assign params to DynamicStrategy
    DynamicStrategy.params = data.get("params", {})

    # Step 5: Run the backtest with provided initial_cash and commission
    try:
        initial_cash = data.get('initial_cash', 10000)
        commission = data.get('commission', 0.002)
        bt = Backtest(df, DynamicStrategy, cash=initial_cash, commission=commission, trade_on_close=False)
        stats = bt.run()
    except KeyError as e:
        print(f"Missing column in data: {e}")
        return jsonify({"error": f"Missing column in data: {e}"}), 400
    except Exception as e:
        print(f"Error during backtesting: {e}")
        return jsonify({"error": f"Error during backtesting: {e}"}), 400

    # Step 6: Collect relevant performance metrics
    total_return = stats.get('Return [%]', "N/A")
    max_drawdown = stats.get('Max. Drawdown [%]', "N/A")
    win_rate = stats.get('Win Rate [%]', "N/A")
    profit_factor = stats.get('Profit Factor', "N/A")
    sharpe_ratio = stats.get('Sharpe Ratio', "N/A")

    # Step 7: Process trade history to prepare it for the frontend
    trade_history = []
    if '_trades' in dir(stats):
        trades_df = stats._trades.copy()
        timedelta_cols = trades_df.select_dtypes(include=['timedelta64[ns]', 'timedelta64']).columns
        for col in timedelta_cols:
            trades_df[col] = trades_df[col].dt.total_seconds()
        trade_history = trades_df.to_dict(orient="records")

    # Step 7: Format results for frontend
    results = {
        "total_return": total_return,
        "max_drawdown": max_drawdown,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "sharpe_ratio": sharpe_ratio,
        "trade_history": trade_history
    }

    return jsonify(results)
    # The following line will never be executed due to the return above
    # return jsonify({"status": "Backtest Success"})


@app.route('/api/get-indicator-data', methods=['GET'])
def get_indicator_data():
    print("Received /api/get-indicator-data request")
    print("Request data:", request.args)
    ticker = request.args.get('ticker')
    indicator = request.args.get('indicator')
    period = request.args.get('period')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    # Log parameter values for debugging
    print("Ticker:", ticker)
    print("Indicator:", indicator)
    print("Period:", period)
    print("Start Date:", start_date)
    print("End Date:", end_date)

    # Validate inputs
    if not ticker or not indicator or not period or not start_date or not end_date:
        return jsonify({'error': 'ticker, indicator, period, start_date, and end_date are required parameters'}), 400

    try:
        # Fetch historical data for the specified ticker
        df = fetch_data(ticker, start_date, end_date)
        print("INDICATOR DATA FETCHED DATA COLUMNS:")
        print("Fetched data columns:", df.columns)
        print("Fetched data sample:", df.head())
        
        df.reset_index(inplace=True)

        # Ensure Date column is in 'yyyy-mm-dd' format
        df['Date'] = pd.to_datetime(df['Date'], errors='coerce').dt.strftime('%Y-%m-%d')

        # Flatten MultiIndex columns if necessary
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [f"{col[0]}" for col in df.columns]
            print("Flattened columns:", df.columns)

        # Check for required columns
        expected_columns = ['Open', 'High', 'Low', 'Close', 'Volume']
        missing_columns = [col for col in expected_columns if col not in df.columns]
        if missing_columns:
            return jsonify({"error": f"DataFrame must include {expected_columns} columns, but is missing {missing_columns}"}), 400

        # Validate and clean data if necessary
        df = validate_and_clean_data(df)

        # Calculate the requested indicator
        indicator_data = calculate_indicators(df, [{'indicator': indicator, 'period': int(period)}])

        # Ensure the result contains the calculated indicator column
        indicator_column = f"{indicator}_{period}"
        if indicator_column not in indicator_data.columns:
            return jsonify({'error': f"Indicator {indicator} with period {period} could not be calculated"}), 400
        
        # Filter out rows with NaN values in the indicator column
        indicator_data = indicator_data[['Date', indicator_column]].dropna(subset=[indicator_column])

        # Replace any remaining NaNs with None to ensure valid JSON serialization
        indicator_data[indicator_column] = indicator_data[indicator_column].replace({np.nan: None})

        # Prepare the data for JSON response
        response_data = indicator_data[['Date', indicator_column]].rename(columns={indicator_column: 'value'}).to_dict(orient='records')

        print(f"Formatted {indicator} data:", response_data[:5])  # Log a sample of the data
        return jsonify(response_data)

    except Exception as e:
        print("Exception occurred:", e)
        return jsonify({'error': str(e)}), 400


if __name__ == '__main__':
    # Remove debug=True for production
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
