const logRequest = (req, res, next) => {
  const date = new Date();
  console.log(
    "[LOG] [%s] request %s been made by %s",
    date,
    req.url,
    req.user.username
  );
  next();
};

module.exports = logRequest;
