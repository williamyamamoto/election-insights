//------------------------------------------------------------------------------
// Copyright IBM Corp. 2015
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//------------------------------------------------------------------------------

/** Module dependencies. */
var express = require('express');
var bodyParser = require('body-parser');
var path = require('path');
var logger = require('morgan');
var routes = require('./routes');
var newsScraper = require('./newsScraper');
var entitiesDB = require('./entitiesDB');

var moment = require('moment');

/** configure the express server */
var app = express();

// if we're developing, use webpack middleware for module hot reloading
if (process.env.NODE_ENV !== 'production') {
  console.log('==> 🌎 using webpack');

  // load and configure webpack
  const webpack = require('webpack');
  const webpackDevMiddleware = require('webpack-dev-middleware');
  const webpackHotMiddleware = require('webpack-hot-middleware');
  const config = require('../webpack/web.dev.config');

  // setup middleware
  const compiler = webpack(config);
  app.use(webpackDevMiddleware(compiler, { noInfo: true, publicPath: config.output.publicPath }));
  app.use(webpackHotMiddleware(compiler));
}

app.set('port', process.env.PORT || 3000);
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.resolve(__dirname, '../public')));
app.use('/', routes);

/** Start her up, boys */
app.listen(app.get('port'), function() {
  console.log('Express server listening on port ' + app.get('port'));
});

var _intervalID;
var failureCount = 0;
function getAndParseMostRecentArticles () {
  entitiesDB.getMinAndMaxDates().then(function (minAndMax) {
    var start = minAndMax.max ? minAndMax.max/1000 : null;
    return newsScraper.getEntities(start + 1);
  }).then(function (entities) {
    return entitiesDB.uploadArticlesFromDocs(entities);
  }).catch(function (e) {
    console.log('article scraping failed');
    console.error(e);
    if (++failureCount > 5) {
      clearInterval(_intervalID);
    }
  });
}

function parseForever () {
  // get them now
  getAndParseMostRecentArticles();
  // get more ever 15m
  _intervalID = setInterval(getAndParseMostRecentArticles, 15*60*1000);
  // in 24h, reset the failure count and interval, and prune the database
  // of everything older than 30d
  setTimeout(function () {
    entitiesDB.pruneOlderThan30d();
    failureCount = 0;
    _intervalID && clearInterval(_intervalID);
    parseForever();
  }, 24*60*60*1000);
}

entitiesDB.init().then(parseForever);
