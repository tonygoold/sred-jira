'use strict';

var JiraApi = require('jira').JiraApi;
var util = require('util');
var config = require('../sred-jira-config.json');

var jira = new JiraApi('https', config.host, config.port, config.user, config.password, '2');
jira.findIssue('WEB-5257', function(error, issue) {
      console.log(util.inspect(issue, true, null));
});
