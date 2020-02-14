import React, { useState } from "react";
import Logo from "../../common/Logo/Logo";
import "./Sidemenu.css";
import { Icon, Divider } from "semantic-ui-react";

const nav = [
  {
    title: "Dashboard",
    icon: "dashboard"
  },
  {
    title: "History",
    icon: "history"
  },
  {
    title: "Login Data",
    icon: "key"
  },
  {
    title: "Web Data",
    icon: "globe"
  },
  {
    title: "Downloads",
    icon: "cloud download"
  },
  {
    title: "Bookmarks",
    icon: "bookmark"
  },
  {
    title: "Favicons",
    icon: "image"
  },
  {
    title: "Cache",
    icon: "folder open"
  }
];

const navAlt = [
  {
    title: "Volume",
    icon: "hdd"
  },
  {
    title: "Database",
    icon: "database"
  }
];

function Sidemenu() {
  const [selected, setSelected] = useState(0);

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
        {nav.map((el, i) => (
          <div
            key={i}
            onClick={() => setSelected(i)}
            className={`item ${selected === i ? "selected" : null}`}
          >
            <p>
              <Icon name={el.icon} style={{ marginRight: "20px" }} />
              &nbsp;
              {el.title}
            </p>
          </div>
        ))}
        <Divider horizontal inverted>
          More
        </Divider>
        {navAlt.map((el, i) => (
          <div
            key={i + nav.length}
            onClick={() => setSelected(i + nav.length)}
            className={`item ${
              selected === i + nav.length ? "selected" : null
            }`}
          >
            <p>
              <Icon name={el.icon} style={{ marginRight: "20px" }} />
              &nbsp;
              {el.title}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Sidemenu;
