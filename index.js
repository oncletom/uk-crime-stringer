'use strict';

var _defaults = require('lodash.defaults');
var Promise = require('es6-promise').Promise;

var DEFAULTS = {
  lat: null,
  lng: null,
  mounthCount: null,
  threshold: null
};

function getLastUpdateTimeRef(stringer){
  return new Promise(function(resolve, reject){
    stringer.cache.read('crime-stringer-reference:lastUpdate', function(err, lastUpdateTimeRef){
      if (err){
        return reject(err);
      }

      resolve(lastUpdateTimeRef);
    });
  });
}

module.exports = function (stringer, options) {
  var configuredOptions = _defaults(options, DEFAULTS);

  // get last update date, so that we know where to start from.
  Promise.all([
    stringer.http.get('http://data.police.uk/api/crime-last-updated'),
    getLastUpdateTimeRef(stringer)
  ])
  .then(function(results){
    var lastUpdateTimeRef = results[1];
    var currentDate = new Date(results[0].data.date);

    if (currentDate <= lastUpdateTimeRef) {
      return;
    }

    stringer.cache.write(
      'crime-stringer-reference:lastUpdate',
      JSON.stringify(currentDate)
    );

    return currentDate;
  })
  .then(getCrimeArrayFromDate(stringer, options))
  .then(getCategoriesFromCrimeResponses(stringer, options))
  .catch(console.error.bind(console));
};

function getCrimeArrayFromDate(stringer, options){
  return function(currentDate) {
    var baseQuery = "http://data.police.uk/api/crimes-street/all-crime?lat=" +
      options.lat + "&lng=" + options.lng;

    var requests = [];

    while (options.mounthCount--) {
      // build query for current month
      var currMonth = currentDate.getMonth() + 1; // months start at 0 ¬_¬
      currMonth = currMonth > 9 ? String(currMonth) : '0' + String(currMonth);
      var timeQuery = "&date=" + currentDate.getFullYear() + "-" + currMonth;

      console.log('police-uk: fetching data for ' + timeQuery);
      requests.push(stringer.http.get(baseQuery + timeQuery, { transformResponse: transformCrimeResponse}));

      currentDate.setMonth(currentDate.getMonth() - 1);
    }

    return Promise.all(requests);
  };
}

function getCategoriesFromCrimeResponses(stringer, options){
  var callback = console.log.bind(console);

  return function(responses){
    // compute average for each category, over the time range
    var categories = Object.keys(responses[0].data);
    var numberOfMonths = responses.length;
    var categoryAverages = {};

    categories.forEach(function(cat){
      categoryAverages[cat] = responses.reduce(function(total, response){
        if (cat in response.data) {
          return total + response.data[cat];
        }
      }, 0);

      categoryAverages[cat] /= numberOfMonths;
    });

    // for each category, compute the diff btw crime amount for last month and
    // average.
    // callback if > threshold
    categories.forEach(function(cat){
      var categoryDiff = (responses[0].data[cat] - categoryAverages[cat]) / categoryAverages[cat] * 100;

      if (Math.abs(categoryDiff) > Math.abs(options.threshold)) {
        //todo: mettre le mois dans le triggerResult
        callback('crime-stringer', cat + ', diff: ' + categoryDiff);
      }
    });
  };
}

function transformCrimeResponse(response) {
  var monthCrimeStat = {};
  var data = JSON.parse(response);

  data.forEach(function(crimeRecord){
    if (!(crimeRecord.category in monthCrimeStat)) {
      monthCrimeStat[crimeRecord.category] = 0; // 1st crime seen for this category
    }

    monthCrimeStat[crimeRecord.category] += 1;
  });

  return monthCrimeStat;
}
