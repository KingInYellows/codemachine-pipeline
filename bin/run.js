#!/usr/bin/env node

// Production entry point for ai-feature CLI
// Force compiled sources even in test/dev NODE_ENV to avoid ts-node auto-transpile.
globalThis.oclif = globalThis.oclif ?? {};
globalThis.oclif.enableAutoTranspile = false;
globalThis.oclif.tsnodeEnabled = false;

const oclif = require('@oclif/core');

oclif.run().then(require('@oclif/core/flush')).catch(require('@oclif/core/handle'));
