'use strict';

var express = require('express');
var hbs = require('express-hbs');
var util = require('util');
var JiraApi = require('jira').JiraApi;
var bodyParser = require('body-parser');
var _ = require('lodash');

var JiraQuery = require('./jiraquery');

try {
  var config = require('../sred-jira-config.json');
} catch(e) {
  var config = {
    host: process.env.JIRA_HOST,
    port: process.env.JIRA_PORT,
    user: process.env.JIRA_USER,
    password: process.env.JIRA_PASS
  };
}

var jira = new JiraApi('https', config.host, config.port, config.user, config.password, '2');
var app = express();

app.engine('hbs', hbs.express4());
app.set('view engine', 'hbs');
app.set('views', __dirname + '/views');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

hbs.registerHelper('pagination', function(current, total, perPage, query, options) {
  var pages = '';
  for (var i = 0; i < total; i += perPage) {
    if (i == current) {
      pages += '<span>' + ( _.floor(i / perPage) + 1) + '</span>';
    } else {
      pages += '<a href="/?query=' + encodeURIComponent(query) + '&start=' + encodeURIComponent(i) + '">' +
        (_.floor(i / perPage) + 1) + '</a>';
    }
  }
  return new hbs.SafeString(pages);
});

app.get('/', function(req, res) {
  var query = req.query.query || 'project = web';
  var start = req.query.start || 0;
  jira.searchJira(query, { fields: ['*all'], expand:['changelog'], start: start }, function(error, body) {
    if (error) {
      res.render('index', {
        errors: error.errorMessages,
        query: query
      });
    } else {
      res.render('index', {
        start: start,
        total: body.total,
        query: query,
        issues: _.map(body.issues, function(issue) {
          issue.checked = true;
          return issue;
        })
      });
    }
  });
});

app.post('/calculate', function(req, res) {
  var query = new JiraQuery();
  var tickets = _.keys(_.omit(req.body, ['query', 'start']));
  var queryPromise = query.addTickets(tickets);
  var start = req.query.start || 0;
  queryPromise.then(function() {
    jira.searchJira(req.body.query, { fields: ['*all'], expand:['changelog'], start: start }, function(error, body) {
      if (error) {
        res.render('index', {
          errors: error.errorMessages,
          query: req.body.query
        });
      } else {
        var calendar = query.getCalendar();
        var people = calendar.getPeople();
        var data = {
          start: start,
          total: body.total,
          query: req.body.query,
          issues: _.map(body.issues, function(issue) {
            if (_.indexOf(tickets, issue.key) != -1) {
              issue.checked = true;
            }
            return issue;
          }),
          people: _.reduce(people, function(acc, person) {
                    acc.push({
                      name: person,
                      hours: calendar.getWorkingHours(person)
                    });
                    return acc;
                  }, [])
        };

        res.render('index', data);
      }
    });
  });
});

var port = process.env.PORT || 3000;

app.listen(port, function() {
  console.log('listening on port', port);
});
