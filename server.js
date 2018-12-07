'use strict';

// Adds dependencies
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

// Loads environment variables
require('dotenv').config();

// Sets up app constants
const PORT = process.env.PORT || 3000;
const app = express();

// Sets up database
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('err', err => console.log(err));

// Allows public access to API
app.use(cors());

// Starts the server
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});

// Error Handler
function handleError(err, res) {
  console.error('ERROR', err);
  if (res) res.status(500).send('This location is not a valid input');
}

// Requests location data
app.get('/location', getLocation);

// Requests weather data
app.get('/weather', getWeather);

// Requests restaurant data
app.get('/yelp', getRestaurants);

// Requests movie data
app.get('/movies', getMovies);

// Requests meetup data
app.get('/meetups', getMeetups);

// Requests trail data
app.get('/trails', getTrails);


// Clears the DB of a location if data is stale
function deleteByLocationId(table, city) {
  const SQL = `DELETE from ${table} WHERE location_id=${city};`;
  console.log(`Deleting ID ${city} from table ${table}`);
  return client.query(SQL);
}


// Location constructor
function Location(query, data) {
  this.search_query = query;
  this.formatted_query = data.formatted_address;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
  this.createdAt = Date.now();
}
// Saves location to the database
Location.prototype.save = function() {
  let SQL = `
    INSERT INTO locations
      (search_query, formatted_query, latitude, longitude, created_at) 
      VALUES($1, $2, $3, $4, $5) 
      RETURNING id;
  `;
  let values = Object.values(this);
  return client.query(SQL,values);
};

// Gets location from db cahce or makes request to fetch from API
function getLocation(req, res) {
  const locationHandler = {
    query: req.query.data,
    cacheHit: (results) => {
      console.log('Got location data from SQL');
      res.send(results.rows[0]);
    },
    cacheMiss: () => {
      Location.fetchLocation(req.query.data).then(data => res.send(data));
    },
  };
  Location.lookupLocation(locationHandler);
}

// Fetches location from the API and saves to the database
Location.fetchLocation = (query) => {
  const _URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;
  return superagent.get(_URL).then(data => {
    console.log('Got location data from the API', data.body.results);
    // If no results from API
    if (!data.body.results.length) {throw 'No data';}
    else {
      // Creates an instance and saves to database
      let location = new Location(query, data.body.results[0]);
      return location.save().then(result => {
        location.id = result.rows[0].id;
        return location;
      });
      return location;
    }
  });
};

// Looks up location from database
Location.lookupLocation = (handler) => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1;`;
  const values = [handler.query];

  return client.query(SQL, values).then(results => {
    if (results.rowCount > 0) {
      handler.cacheHit(results);
    } else {
      handler.cacheMiss();
    }
  }).catch(error => handleError(error));
};


// Weather constructor
function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toDateString();
  this.created_at = Date.now();
}
// Saves weather to db
Weather.prototype.save = function(id) {
  const SQL = `INSERT INTO weathers (forecast, time, created_at, location_id) VALUES ($1, $2, $3, $4);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Gets weather from db cahce or makes request to fetch from API
function getWeather(req, res) {
  const weatherHandler = {
    location: req.query.data,
    cacheHit: (result) => {
      res.send(result.rows);
    },
    cacheMiss: () => {
      Weather.fetchWeather(req.query.data).then(results => res.send(results)).catch(error => handleError(error));
    },
  };
  Weather.lookupWeather(weatherHandler);
}

// Fetches weather from the API and saves to the database
Weather.fetchWeather = function(location) {
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${location.latitude},${location.longitude}`;

  return superagent.get(url).then(result => {
    const weatherSummaries = result.body.daily.data.map(day => {
      const summary = new Weather(day);
      summary.save(location.id);
      return summary;
    });
    return weatherSummaries;
  });
};

// Looks up weather from database
Weather.lookupWeather = function(handler) {
  const SQL = `SELECT * FROM weathers WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id]).then(result => {
    if(result.rowCount > 0) {
      console.log('Got weather data from SQL');
      // Checks to see if DB data is stale then deletes and gets new API data if so
      let reqAgeMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      console.log(handler.location.id);
      console.log(reqAgeMins);
      if (reqAgeMins > 1) {
        console.log(`...but it's stale!`);
        deleteByLocationId('weathers', handler.location.id);
        handler.cacheMiss();
      } else {
        handler.cacheHit(result)
      }
    } else {
      console.log('Got weather data from API');
      handler.cacheMiss();
    }
  }).catch(error => handleError(error));
};



// Restaurant constructor for Yelp
function Restaurant(business) {
  this.name = business.name;
  this.image_url = business.image_url;
  this.price = business.price;
  this.rating = business.rating;
  this.url = business.url;
  this.created_at = Date.now();
}

// Saves restaurants to db
Restaurant.prototype.save = function(id) {
  const SQL = `INSERT INTO restaurants (name, image_url, price, rating, url, created_at, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Gets restaurants from db cahce or makes request to fetch from API
function getRestaurants(req, res) {
  const restaurantHandler = {
    location: req.query.data,
    cacheHit: (result) => {
      res.send(result.rows);
    },
    cacheMiss: () => {
      Restaurant.fetchRestaurant(req.query.data).then(results => res.send(results)).catch(error => handleError(error));
    },
  };
  Restaurant.lookupRestaurant(restaurantHandler);
}

// Fetches restautants from the API and saves to the database
Restaurant.fetchRestaurant = function(location) {
  const url = `https://api.yelp.com/v3/businesses/search?location=${location.search_query}`;

  return superagent.get(url).set('Authorization', `Bearer ${process.env.YELP_API_KEY}`).then(result => {
    const businesses = result.body.businesses.map(place => {
      const business = new Restaurant(place);
      business.save(location.id);
      return business;
    });
    return businesses;
  });
};

// Looks up restuarants from database
Restaurant.lookupRestaurant = function(handler) {
  const SQL = `SELECT * FROM restaurants WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id]).then(result => {
    if(result.rowCount > 0) {
      // Checks to see if DB data is stale then deletes and gets new API data if so
      let reqAgeMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (reqAgeMins > 2) {
        console.log(`...but it's stale!`);
        deleteByLocationId('restaurants', handler.location.id);
        handler.cacheMiss();
      } else {
        handler.cacheHit(result)
      }
    } else {
      console.log('Got restaurant data from API');
      handler.cacheMiss();
    }
  }).catch(error => handleError(error));
};


// Movie data constructor
function Movie(data) {
  this.title = data.title;
  this.overview = data.overview;
  this.average_votes = data.vote_average;
  this.total_votes = data.vote_count;
  this.image_url = `https://image.tmdb.org/t/p/w200_and_h300_bestv2/${data.poster_path}`;
  this.popularity = data.popularity;
  this.released_on = data.release_date;
  this.created_at = Date.now();
}
// Saves movies to db
Movie.prototype.save = function(id) {
  const SQL = `INSERT INTO movies (title, overview, average_votes, total_votes, image_url, popularity, released_on, created_at, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Gets movies from db cahce or makes request to fetch from API
function getMovies(req, res) {
  const movieHandler = {
    location: req.query.data,
    cacheHit: (result) => {
      res.send(result.rows);
    },
    cacheMiss: () => {
      Movie.fetchMovies(req.query.data).then(results => res.send(results)).catch(error => handleError(error));
    },
  };
  Movie.lookupMovies(movieHandler);
}

// Fetches movies from the API and saves to the database
Movie.fetchMovies = function(location) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIEDB_API_KEY}&query=${location.search_query}`;

  return superagent.get(url).then(result => {
    const movieData = result.body.results.map(data => {
      const movie = new Movie(data);
      movie.save(location.id);
      return movie;
    });
    return movieData;
  });
};

// Looks up movies from database
Movie.lookupMovies = function(handler) {
  const SQL = `SELECT * FROM movies WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id]).then(result => {
    if(result.rowCount > 0) {
      console.log('Got movie data from SQL');
      // Checks to see if DB data is stale then deletes and gets new API data if so
      let reqAgeMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (reqAgeMins > 3) {
        console.log(`...but it's stale!`);
        deleteByLocationId('movies', handler.location.id);
        handler.cacheMiss();
      } else {
        handler.cacheHit(result);
      }
    } else {
      console.log('Got movie data from API');
      handler.cacheMiss();
    }
  }).catch(error => handleError(error));
};


// Meetup data constructor
function Meetup(data) {
  this.link = data.event_url;
  this.name = data.name;
  this.creation_date = new Date(data.created).toDateString();
  this.host = data.group.name;
  this.created_at = Date.now();
}
// Saves meetups to db
Meetup.prototype.save = function(id) {
  const SQL = `INSERT INTO meetups (link, name, creation_date, host, created_at, location_id) VALUES ($1, $2, $3, $4, $5);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Gets meetups from db cahce or makes request to fetch from API
function getMeetups(req, res) {
  const meetupHandler = {
    location: req.query.data,
    cacheHit: (result) => {
      res.send(result.rows);
    },
    cacheMiss: () => {
      Meetup.fetchMeetups(req.query.data).then(results => res.send(results)).catch(error => handleError(error));
    },
  };
  Meetup.lookupMeetups(meetupHandler);
}

// Fetches meetups from the API and saves to the database
Meetup.fetchMeetups = function(location) {
  const url = `https://api.meetup.com/2/open_events?&key=${process.env.MEETUP_API_KEY}&sign=true&photo-host=public&lat=${location.latitude}&topic=softwaredev&lon=${location.longitude}&page=20`;

  return superagent.get(url).then(result => {
    const meetupData = result.body.results.map(data => {
      const meetup = new Meetup(data);
      meetup.save(location.id);
      return meetup;
    });
    return meetupData;
  });
};

// Looks up meetups from database
Meetup.lookupMeetups = function(handler) {
  const SQL = `SELECT * FROM meetups WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id]).then(result => {
    if(result.rowCount > 0) {
      console.log('Got meetup data from SQL');
      // Checks to see if DB data is stale then deletes and gets new API data if so
      let reqAgeMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (reqAgeMins > 4) {
        console.log(`...but it's stale!`);
        deleteByLocationId('meetups', handler.location.id);
        handler.cacheMiss();
      } else {
        handler.cacheHit(result)
      }
    } else {
      console.log('Got meetup data from API');
      handler.cacheMiss();
    }
  }).catch(error => handleError(error));
};


// Trails data constructor
function Trail(data) {
  this.name = data.name;
  this.location = data.location;
  this.length = data.length;
  this.stars = data.stars;
  this.star_votes = data.starVotes;
  this.summary = data.summary;
  this.trail_url = data.url;
  this.conditions = data.conditionDetails;
  this.condition_date = data.conditionDate.split(' ').slice(0, 1).toString();
  this.condition_time = data.conditionDate.split(' ').slice(1, 2).toString();
  this.created_at = Date.now();
}
// Saves trails to db
Trail.prototype.save = function(id) {
  const SQL = `INSERT INTO trails (name, location, length, stars, star_votes, summary, trail_url, conditions, condition_date, condition_time, created_at, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

// Gets trails from db cahce or makes request to fetch from API
function getTrails(req, res) {
  const trailHandler = {
    location: req.query.data,
    cacheHit: (result) => {
      res.send(result.rows);
    },
    cacheMiss: () => {
      Trail.fetchTrails(req.query.data).then(results => res.send(results)).catch(error => handleError(error));
    },
  };
  Trail.lookupTrails(trailHandler);
}

// Fetches trails from the API and saves to the database
Trail.fetchTrails = function(location) {
  const url = `https://www.hikingproject.com/data/get-trails?lat=${location.latitude}&lon=${location.longitude}&maxDistance=20&key=${process.env.TRAIL_API_KEY}`;

  return superagent.get(url).then(result => {
    const trailData = result.body.trails.map(data => {
      const trail = new Trail(data);
      trail.save(location.id);
      return trail;
    });
    return trailData;
  });
};

// Looks up trails from database
Trail.lookupTrails = function(handler) {
  const SQL = `SELECT * FROM trails WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id]).then(result => {
    if(result.rowCount > 0) {
      console.log('Got trail data from SQL');
      // Checks to see if DB data is stale then deletes and gets new API data if so
      let reqAgeMins = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (reqAgeMins > 5) {
        console.log(`...but it's stale!`);
        deleteByLocationId('trails', handler.location.id);
        handler.cacheMiss();
      } else {
        handler.cacheHit(result)
      }
    } else {
      console.log('Got trail data from API');
      handler.cacheMiss();
    }
  }).catch(error => handleError(error));
};
