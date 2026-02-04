#!/usr/bin/env node

// Development entry point for codepipe CLI
// Uses ts-node to run TypeScript source directly without building

const path = require('path');
const project = path.join(__dirname, '..', 'tsconfig.json');

// Register ts-node for TypeScript execution
require('ts-node').register({ project });

// Load source from src/ directory
require(`${path.join(__dirname, '..', 'src')}`).run();
