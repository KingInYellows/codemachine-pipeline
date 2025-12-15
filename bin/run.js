#!/usr/bin/env node

// Production entry point for ai-feature CLI
const oclif = require('@oclif/core');

oclif.run().then(require('@oclif/core/flush')).catch(require('@oclif/core/handle'));
