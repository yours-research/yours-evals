# Contributing to `@yours/evals`

Thank you for helping improve local inference quality and safety across the Yours Research ecosystem.

## Development Workflow

1. **Requirements:** Node.js `>= 20.0.0` and npm `>= 10`.
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Verify before committing:**
   ```bash
   npm run typecheck
   npm run build
   npm test
   ```
4. **Standards:**
   - Strictly follow all contracts in [`docs/ECOSYSTEM_CONTRACTS.md`](./docs/ECOSYSTEM_CONTRACTS.md).
   - Keep datasets 100% deterministic and offline (zero external network calls).
   - When adding a new eval case or suite metric, include corresponding unit tests in `tests/` covering both passing baselines and adversarial failure detection.
   - Update `compareScorecards` polarity rules if introducing a new lower-is-better metric.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](./LICENSE).
