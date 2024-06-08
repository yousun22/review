module.exports = function(req, res, next) {
    if (!req.session.userId && req.path !== '/login1') {
        return res.redirect('/userif/login1');
    }
    next();
};
