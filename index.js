const express = require('express');
const axios = require('axios');
require('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis();

const app = express();
const port = 3000;

const API_KEY = process.env.WEATHER_API_KEY;

let externalApiRequestCounter = 0;
let totalApiRequestCounter = 0;

const getWeather = async city => {
  console.log("Making api request");

  externalApiRequestCounter += 1;

  try {
    const response = await axios.get(
        `http://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${city}&aqi=no`
    );

    return response.data;
  } catch (err) {
    console.error(err)
  }
};

const getFromCache = async key => {
  const cacheResult = await redis.get(key);

  if (!cacheResult) {
    return {data: null};
  }

  const cacheResultTtl = await redis.ttl(key);

  return {data: JSON.parse(cacheResult), ttl: cacheResultTtl};
}

const setCacheValue = ({key, value, expirationInSeconds}) => redis.set(
    key, JSON.stringify(value), 'ex', expirationInSeconds
);

const shouldRecompute = ({lastRecomputeDuration, keyTtlInSeconds}) => {
  // time to recompute value
  const delta = lastRecomputeDuration;
  // > 1 favours earlier recomputation, < 1 favours later
  const beta = 2;
  const random = Math.random();
  const xfetch = delta * beta * Math.log(random);

  const currentTimestampInSeconds = Math.round(Date.now() / 1000);
  const cacheExpiresAt = currentTimestampInSeconds + keyTtlInSeconds;

  const isEarlyRecomputeRequired = (currentTimestampInSeconds - xfetch)
      >= cacheExpiresAt;

  return isEarlyRecomputeRequired;
}

const getCachedWeather = async city => {
  const cacheKey = `weatherapi:${city}`;

  const {data: cachedResult, ttl: cachedResultTtl} = await getFromCache(
      cacheKey
  );

  if (!cachedResult) {
    const weather = await getWeather(city);

    await setCacheValue({
      key: cacheKey,
      value: weather,
      expirationInSeconds: 20
    });

    return weather;
  }

  const isRecomputeRequired = shouldRecompute(
      {
        lastRecomputeDuration: 0.1, keyTtlInSeconds: cachedResultTtl
      });

  if (isRecomputeRequired) {
    const weather = await getWeather(city);

    await setCacheValue({
      key: cacheKey,
      value: weather,
      expirationInSeconds: 20
    });

    return weather;
  }

  return cachedResult;
}

app.get('/weather', async (req, res) => {
  totalApiRequestCounter += 1
  const city = req.query.city;
  const weather = await getCachedWeather(city);

  res.send({data: weather});
})

app.get('/counters', async (req, res) => {
  res.send({externalApiRequestCounter, totalApiRequestCounter});
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
