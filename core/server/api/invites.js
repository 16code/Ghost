var _ = require('lodash'),
    Promise = require('bluebird'),
    validator = require('validator'),
    pipeline = require('../utils/pipeline'),
    dataProvider = require('../models'),
    settings = require('./settings'),
    mail = require('./../mail'),
    apiMail = require('./mail'),
    globalUtils = require('../utils'),
    utils = require('./utils'),
    errors = require('../errors'),
    config = require('../config'),
    i18n = require('../i18n'),
    docName = 'invites',
    allowedIncludes = ['created_by', 'updated_by'],
    invites;

invites = {
    browse: function browse(options) {
        var tasks;

        //@TODO: do not return tokens
        function modelQuery(options) {
            options.columns = ['id', 'email', 'status'];
            return dataProvider.Invite.findPage(options);
        }

        tasks = [
            utils.validate(docName, {opts: utils.browseDefaultOptions}),
            utils.handlePublicPermissions(docName, 'browse'),
            utils.convertOptions(allowedIncludes),
            modelQuery
        ];

        return pipeline(tasks, options);
    },

    read: function read(options) {
        var attrs = ['id', 'email'],
            tasks;

        function modelQuery(options) {
            return dataProvider.Invite.findOne(options.data, _.omit(options, ['data']));
        }

        tasks = [
            utils.validate(docName, {attrs: attrs}),
            utils.handlePublicPermissions(docName, 'read'),
            utils.convertOptions(allowedIncludes),
            modelQuery
        ];

        return pipeline(tasks, options)
            .then(function formatResponse(result) {
                if (result) {
                    return {invites: [result.toJSON(options)]};
                }

                return Promise.reject(new errors.NotFoundError(i18n.t('errors.api.invites.inviteNotFound')));
            });
    },

    destroy: function destroy(options) {
        var tasks;

        function modelQuery(options) {
            return dataProvider.Invite.findOne(options.data, _.omit(options, ['data']))
                .then(function (invite) {
                    return invite.destroy(options).return(null);
                }).catch(dataProvider.Invite.NotFoundError, function () {
                    throw new errors.NotFoundError(i18n.t('errors.api.invites.inviteNotFound'));
                });
        }

        tasks = [
            utils.validate(docName, {opts: utils.idDefaultOptions}),
            utils.handlePermissions(docName, 'destroy'),
            utils.convertOptions(allowedIncludes),
            modelQuery
        ];

        return pipeline(tasks, options);
    },
    
    //@TODO: invite email twice?
    //@TODO: fix user1 ;)
    add: function add(object, options) {
        var tasks,
            loggedInUser = options.context.user1,
            emailData,
            invite;

        function modelQuery(options) {
            if (!options.data.invites[0].email) {
                return Promise.reject(new errors.ValidationError(i18n.t('errors.api.invites.emailIsRequired')));
            }

            return dataProvider.Invite.add({
                email: options.data.invites[0].email
            }, options).then(function (_invite) {
                invite = _invite;

                //@TODO: get blogname
                var baseUrl = config.forceAdminSSL ? (config.urlSSL || config.url) : config.url;

                emailData = {
                    blogName: 'Boobie blog',
                    invitedByName: loggedInUser.name,
                    invitedByEmail: loggedInUser.email,
                    //@TODO: resetLink sounds weird
                    resetLink: baseUrl.replace(/\/$/, '') + '/ghost/signup/' + globalUtils.encodeBase64URLsafe(invite.get('token')) + '/'
                };

                return mail.utils.generateContent({data: emailData, template: 'invite-user'});
            }).then(function (emailContent) {
                var payload = {
                    mail: [{
                        message: {
                            to: object.email,
                            subject: i18n.t('common.api.users.mail.invitedByName', {
                                invitedByName: emailData.invitedByName,
                                blogName: emailData.blogName
                            }),
                            html: emailContent.html,
                            text: emailContent.text
                        },
                        options: {}
                    }]
                };

                return apiMail.send(payload, {context: {internal: true}});
            }).then(function () {
                options.id = invite.id;
                return dataProvider.Invite.edit({status: 'sent'}, options);
            });
        }

        tasks = [
            utils.validate(docName, {opts: ['email']}),
            utils.handlePermissions(docName, 'add'),
            utils.convertOptions(allowedIncludes),
            modelQuery
        ];

        return pipeline(tasks, object, options);
    }
};

module.exports = invites;
