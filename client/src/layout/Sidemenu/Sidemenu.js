import React from "react";
import Logo from "../../common/Logo/Logo";
import "./Sidemenu.css";
import { Icon, Divider } from "semantic-ui-react";
import { withRouter } from "react-router-dom";

const nav = [
  {
    title: "Dashboard",
    icon: "dashboard",
    path: "/dashboard"
  },
  {
    title: "History",
    icon: "history",
    path: "/history"
  },
  {
    title: "Login Data",
    icon: "key",
    path: "/logindata"
  },
  {
    title: "Web Data",
    icon: "globe",
    path: "/webdata"
  },
  {
    title: "Downloads",
    icon: "cloud download",
    path: "/downloads"
  },
  {
    title: "Bookmarks",
    icon: "bookmark",
    path: "/bookmarks"
  },
  {
    title: "Favicons",
    icon: "image",
    path: "/favicons"
  },
  {
    title: "Cache",
    icon: "folder open",
    path: "/cache"
  }
];

const navAlt = [
  {
    title: "Volume",
    icon: "hdd",
    path: "/volume"
  },
  {
    title: "Database",
    icon: "database",
    path: "/database"
  }
];

function Sidemenu(props) {
  function selectItem(item) {
    props.history.push(item.path);
  }

  return (
    <div className="sidemenu">
      <div className="logo">
        <Logo color="#6F9CEB" />
        <p style={{ color: "#6F9CEB", marginTop: "-20px" }}>
          Google Chrome forensics tool
        </p>
      </div>
      <div className="nav">
        <Divider horizontal inverted>
          Navigation
        </Divider>{" "}
        {nav.map(item => (
          <div
            key={item}
            onClick={() => selectItem(item)}
            className={`item ${
              props.history.location.pathname === item.path ? "selected" : null
            }`}
          >
            <p>
              <Icon name={item.icon} style={{ marginRight: "20px" }} />
              &nbsp;
              {item.title}
            </p>
          </div>
        ))}
        <Divider horizontal inverted>
          More
        </Divider>
        {navAlt.map(item => (
          <div
            key={item}
            onClick={() => selectItem(item)}
            className={`item ${
              props.history.location.pathname === item.path ? "selected" : null
            }`}
          >
            <p>
              <Icon name={item.icon} style={{ marginRight: "20px" }} />
              &nbsp;
              {item.title}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default withRouter(Sidemenu);
