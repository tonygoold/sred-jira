'use strict';

var JiraApi = require('jira').JiraApi;
var util = require('util');
var moment = require('moment');
var _ = require('lodash');

try {
  var config = require('../sred-jira-config.json');
} catch (e) {
  var config = {
    host: process.env.JIRA_HOST,
    port: process.env.JIRA_PORT,
    user: process.env.JIRA_USER,
    password: process.env.JIRA_PASS
  };
}

var jira = new JiraApi('https', config.host, config.port, config.user, config.password, '2');

var issueTypes = {
  1: 'Bug',
  3: 'Task',
  15: 'Experiment',
  19: 'Story',
  20: 'Exploratory'
};

var statuses = {
  3: 'In Progress',
  10004: 'Review',
  10005: 'In Review',
  10017: 'For Approval',
  10018: 'Backlog',
  10019: 'Selected for Development',
  10026: 'Development',
  10331: 'Merged',
  11431: 'Triage'
};

var activeStatuses = [ 3, 10004, 10005, 10026 ];
var workingStatuses = [ 3, 10026 ];
var reviewStatuses = [ 10004, 10005 ];

function Calendar() {
  this.people = {};
}

Calendar.prototype.addPersonDay = function(person, date) {
  var days = this.people[person];
  if (!days) {
    days = [];
    this.people[person] = days;
  }
  var inArray = days.some(function(day) {
    return day.isSame(date);
  });
  if (!inArray) {
    days.push(date);
  }
};

Calendar.prototype.addPersonDays = function(person, days) {
  days.forEach(function(day) {
    this.addPersonDay(person, day);
  }, this);
};

Calendar.prototype.getPeople = function() {
  var people = [];
  for (var person in this.people) {
    people.push(person);
  }
  return people;
};

Calendar.prototype.getWorkingDays = function(person) {
  var days = this.people[person];
  if (!days) {
    return [];
  }
  return days.filter(function(day) {
    var weekday = day.day();
    return weekday != 0 && weekday != 6;
  });
};

Calendar.prototype.getWorkingHours = function(person) {
  return this.getWorkingDays(person).length * 8;
};

Calendar.prototype.addCalendar = function(calendar) {
  calendar.getPeople().forEach(function(person) {
    this.addPersonDays(person, calendar.getWorkingDays(person));
  }, this);
};

function Transition(user, fromStatus, toStatus, date) {
  this.user = user;
  this.fromStatus = fromStatus;
  this.toStatus = toStatus;
  this.date = date;
}

Transition.prototype.isActivating = function() {
  return activeStatuses.indexOf(this.fromStatus) < 0 &&
       activeStatuses.indexOf(this.toStatus) >= 0;
}

Transition.prototype.isDeactivating = function() {
  return activeStatuses.indexOf(this.fromStatus) >= 0 &&
       activeStatuses.indexOf(this.toStatus) < 0;
}

function Issue(issueJson) {
  this.ticket = issueJson.key;
  this.project = issueJson.fields.project.key;
  this.assignee = _.result(issueJson, 'fields.assignee.name');
  var assignees = [];
  var transitions = [];
  var lastAssignee = null;
  issueJson.changelog.histories.forEach(function(history) {
    var user = history.author.name;
    var date = moment(history.created).startOf('day');
    history.items.forEach(function(item) {
      if (item.fieldtype != 'jira') {
        return;
      }
      if (item.field == 'status') {
        var transition = new Transition(lastAssignee, parseInt(item.from, 10), parseInt(item.to, 10), date);
        transitions.push(transition);
        if (transition.isActivating() && lastAssignee && assignees.indexOf(lastAssignee) < 0) {
          assignees.push(lastAssignee);
        }
      } else if (item.field == 'assignee' && item.to && item.to.length > 0) {
        lastAssignee = item.to;
        // Retroactively assign any unassigned transitions, noting
        // whether any were activating transitions
        var adjustedActivatingTransition = false;
        transitions.forEach(function(transition) {
          if (!transition.user) {
            transition.user = lastAssignee;
            if (transition.isActivating() >= 0) {
              adjustedActivatingTransition = true;
            }
          }
        });
        // Record all assignees in working statuses
        if (adjustedActivatingTransition && assignees.indexOf(lastAssignee) < 0) {
          assignees.push(lastAssignee);
        }
      }
    });
  });
  this.transitions = transitions;
  this.assignees = assignees;
}

Issue.prototype.getActiveDays = function () {
  var lastStart = null;
  var days = [];
  this.transitions.forEach(function(transition) {
    if (transition.isActivating()) {
      lastStart = transition.date;
    } else if (transition.isDeactivating()) {
      var day = moment(lastStart);
      while (day.isSameOrBefore(transition.date)) {
        days.push(day);
        day = moment(day);
        day.add(1, 'd');
      }
      lastStart = null;
    }
  }, this);
  return days;
};

function Project(name) {
  this.name = name;
  this.issues = [];
}

Project.prototype.addIssue = function(issue) {
  var index = this.issues.findIndex(function(otherIssue) {
    return otherIssue.ticket == issue.ticket;
  });
  if (index >= 0) {
    this.issues[index] = issue;
  } else {
    this.issues.push(issue);
  }
};

Project.prototype.removeIssue = function(ticketNumber) {
  var index = this.issues.findIndex(function(otherIssue) {
    return otherIssue.ticket == issue.ticket;
  });
  if (index >= 0) {
    this.issues.splice(index, 1);
  }
};

Project.prototype.getIssues = function() {
  return this.issues;
}

Project.prototype.getCalendar = function() {
  var calendar = new Calendar();
  this.issues.forEach(function(issue) {
    calendar.addPersonDays(issue.assignee, issue.getActiveDays());
  });
  return calendar;
};

function JiraQuery() {
  this.projects = {};
  this.errors = [];
};

JiraQuery.prototype.getProject = function(name) {
  var project = this.projects[name];
  if (!project) {
    project = new Project(name);
    this.projects[name] = project;
  }
  return project;
};

JiraQuery.prototype.getProjects = function() {
  var projects = [];
  for (var name in this.projects) {
    projects.push(this.projects[name]);
  }
  return projects;
};

JiraQuery.prototype.addTicket = function(ticketNumber) {
  var self = this;
  return new Promise(function(resolve, reject) {
    jira.findIssue(ticketNumber + '?expand=changelog', function(error, issueJson) {
      if (error) {
        reject(error);
      }

      try {
        var issue = new Issue(issueJson);
        var project = self.getProject(issue.project);

        if (!issue.assignee) {
          self.errors.push({
            key: issue.ticket,
            message: "has no assignee"
          });
        }
        project.addIssue(issue);
        resolve(issue);
      } catch (ex) {
        console.log("Caught an exception: " + ex.stack);
        reject(ex);
      }
    });
  });
};

JiraQuery.prototype.addTickets = function(ticketNumbers) {
  return Promise.all(ticketNumbers.map(function(ticketNumber) {
    return this.addTicket(ticketNumber);
  }, this));
};

JiraQuery.prototype.removeTicket = function(ticketNumber) {
  this.getProjects().forEach(function(project) {
    project.removeTicket(ticketNumber);
  });
}

JiraQuery.prototype.getCalendar = function() {
  return this.getProjects().reduce(function(previous, project) {
    previous.addCalendar(project.getCalendar());
    return previous;
  }, new Calendar());
}

JiraQuery.prototype.getIssues = function() {
  return this.getProjects().reduce(function(previous, project) {
    return previous.concat(project.getIssues());
  }, []);
};

/* Usage:

var query = new JiraQuery();
query.addTickets(['IOS-6850', 'IOS-6513', 'IOS-6810', 'IOS-6877', 'IOS-2970']).then(function() {
  var calendar = query.getCalendar();
  calendar.getPeople().forEach(function(person) {
    console.log(person + ': ' + calendar.getWorkingHours(person) + ' hours');
  });
  query.getIssues().forEach(function(issue) {
    console.log(issue.ticket + ': ' + issue.assignees.join(', '));
  });
}).catch(function(ex) {
  console.log('Failure: ' + ex);
});

*/
module.exports = JiraQuery;

