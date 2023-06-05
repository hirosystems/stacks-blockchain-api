---
Title: How to use API key
---

# Steps to use API Key

This guide helps you with the steps to use the API key to interact with the Stacks Blockchain API.

1. [Send a request](https://survey.hiro.so/hiroapi) to the Hiro team to get an API key. You will get the response in the form of the following:

```
NAME: x-hiro-api-key
VALUE: Nabcs1234efg56789aaaaaaaaqqqqqqqeeeeee12334345
```

There are multiple ways to interact with the endpoint. However, this document walks you through two ways to make an [API call](https://docs.hiro.so/api#tag/Microblocks/operation/get_microblock_list). You can choose between any of the following methods.

- Using Curl
- Using Postman

## Using Curl

Using curl, you will pass the API key in a `x-hiro-api-key` header. Use the following command as an example to call the API endpoint `https://api.hiro.so/extended/v1/microblock`.

`curl https://api.hiro.so/extended/v1/microblock -H 'x-hiro-api-key: Nabcs1234efg56789aaaaaaaaqqqqqqqeeeeee12334345'`

## Using Postman

The following section walks you through using an API key with [Postman](https://www.postman.com/).

In the Postman request, add the [API endpoint](https://api.hiro.so/extended/v1/microblock) with the Get request. 

Then, add the API key and its value received from the Hiro team in the **Headers** section, as shown in the image below.

Select **Send** to get recent microblocks.

![API-Key](../images/api-key.jpeg)
