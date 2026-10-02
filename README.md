# QuantStorm Trading Trainer

A browser-based educational trading trainer for practising manual market-making and quantitative-finance decision-making.

**Live demo:** [quantstorm-training.netlify.app](https://quantstorm-training.netlify.app/)

## Overview

The trainer contains interactive lessons, trading scenarios and timed drills covering:

- Fair-value estimation and updating
- Order-book execution
- ETF and basket arbitrage
- Put-call parity and option-value reasoning
- Adverse selection and market-making tactics
- Inventory and mark-to-market P&L
- Mental arithmetic under time pressure

The project was created to support preparation for the QuantStorm quantitative-finance trading competition and to make market-making concepts easier to practise repeatedly.

## Features

- Browser-based interface with no backend or installation required
- Configurable practice scenarios and seeded sessions
- Trade and drill modes
- Fair-value and arbitrage exercises
- P&L, position and inventory tracking
- Tutorial material explaining the underlying concepts

## Repository structure

```text
quantstorm-trainer/
├── index.html           # Application shell and interface
├── src/
│   ├── app.js           # UI state, event handlers and application flow
│   ├── engine.js        # Market state, pricing, orders, fills and P&L logic
│   ├── drills.js        # Timed arithmetic, valuation and trading drills
│   ├── tutorial.js      # In-app educational content
│   └── style.css        # Interface styling
└── README.md
```

## Running locally

No build step is required. Either open `index.html` directly in a browser or serve the directory with a local static server:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## My contribution

I defined the learning objectives and trading concepts, tested the trainer through repeated practice sessions, reviewed the market mechanics and used it to study execution, arbitrage, inventory and adverse-selection decisions. I also maintain the live deployment and the project documentation.

The project incorporates GenAI-assisted development for initial scaffolding and iterative refinement. I defined the learning objectives, reviewed and tested the implementation, maintained the deployment, and documented the project. It is published as an educational practice project rather than as a production exchange or an automated trading system.

## Limitations

This is a simplified training environment. It does not model a production exchange, low-latency execution, real market data, complete order-book matching or validated investment strategies. Results from the trainer should not be interpreted as financial advice or evidence of live-market profitability.

## License

This project is provided for educational and portfolio use. Add a formal open-source license before accepting external contributions or redistributing the code.
