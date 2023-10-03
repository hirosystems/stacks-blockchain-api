---
title: Storing data with Gaia
---

# Gaia Storage

The Gaia storage system allows you to store private app data off the blockchain and still access it securely
with Stacks applications. Where possible, apps should only store critical transactional metadata directly on
the Stacks blockchain, while keeping app and user data in the Gaia storage system. For more information about
the Gaia storage system, see the [Gaia protocol reference](https://docs.stacks.co/build-apps/references/gaia).

A [Gaia hub](https://docs.stacks.co/build-apps/references/gaia#user-control-or-how-is-gaia-decentralized) consists of a service and a storage
resource, generally hosted on the same cloud compute provider. The hub service requires an authentication token from a
storage requester, and writes key-value pairs to the associated storage resource. Individual storage users can choose their Gaia
hub provider. The linked documentation provides an overview of how to set up and operate a Gaia hub.
