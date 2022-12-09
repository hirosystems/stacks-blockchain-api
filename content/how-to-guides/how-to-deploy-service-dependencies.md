---
Title: Deploy Service Dependencies
---

# Deploy Service Dependencies

Now that you have installed Docker and started the API server, you should now deploy related service dependencies.

To deploy service dependencies, run the following npm command in your terminal window:

`npm run devenv:deploy`

This command uses `docker-compose` to deploy the service dependencies (for example, PostgreSQL, Stacks core node, etc).
