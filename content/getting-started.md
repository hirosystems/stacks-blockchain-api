---
Title: Getting Started
---

# Getting Started

This page describes how you can start the API server and service dependencies.

## Prerequisites

Before you can start the API server and its dependencies, you must first ensure that Docker is already installed on your machine. If you do not aready have Docker installed, please install Docker.

## Starting the API Server

To start the API server:

1. Clone the [Stacks Blockchain API](https://github.com/hirosystems/stacks-blockchain-api) repository.
2. Install the related dependencies with the following command:

`npm install`

3. Start the API server and service dependencies by entering the following command in your terminal:

`Run npm run dev:integrated`

4. Verify the server has started successfully by going to http://localhost:3999/extended/v1/status.
