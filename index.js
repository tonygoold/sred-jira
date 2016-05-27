'use strict';

var express = require('express');
var hbs = require('express-hbs');
var util = require('util');
var JiraApi = require('jira').JiraApi;
var config = require('../sred-jira-config.json');

var jira = new JiraApi('https', config.host, config.port, config.user, config.password, '2');
var app = express();

app.engine('hbs', hbs.express4({
    partialsDir: __dirname + '/views/partials'
}));
app.set('view engine', 'hbs');
app.set('views', __dirname + '/views');

app.get('/', function(req, res) {
  var query = req.query.query || 'project = web';
  jira.searchJira(query, { fields: ['*all'], expand:['changelog'] }, function(error, body, resp) {
    if (error) {
      res.render('index', {
        errors: error.errorMessages,
        query: query
      });
    } else {
      res.render('index', {
        query: query,
        issues: body.issues
      });
    }
  });
});

app.listen(3000, function() {
  console.log('listening on port 3000!');
});
