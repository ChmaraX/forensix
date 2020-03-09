import React, { useState } from "react";
import "./Login.css";
import { Segment, Divider, Button, Form, Input } from "semantic-ui-react";
import Logo from "../common/Logo/Logo";
import CenteredWrapper from "../layout/CenteredWrapper/CenteredWrapper";
import { useDispatch } from "react-redux";
import { auth } from "../store/actions/auth";
import axios from "../axios-api";

function Login() {
  const dispatch = useDispatch();
  const [showLogin, setShowLogin] = useState(true);
  const [loginData, setLoginData] = useState({
    username: "",
    password: ""
  });
  const [registerData, setRegisterData] = useState({
    firstName: "",
    lastName: "",
    username: "",
    password: ""
  });

  const handleLoginSubmit = () => {
    dispatch(auth(loginData.username, loginData.password));
  };

  const handleRegisterSubmit = () => {
    axios.post("/users/register", registerData).then(res => {
      setShowLogin(true);
    });
  };

  const handleLoginChange = (e, { name, value }) => {
    setLoginData({ ...loginData, [name]: value });
  };

  const handleRegisterChange = (e, { name, value }) => {
    setRegisterData({ ...registerData, [name]: value });
  };

  const signInSegment = (
    <>
      <h1>Sign In</h1>
      <br />
      <Form onSubmit={handleLoginSubmit}>
        <Form.Field>
          <label>Username</label>
          <Input
            name="username"
            icon="user"
            placeholder="Username"
            onChange={handleLoginChange}
          />
        </Form.Field>
        <Form.Field>
          <label>Password</label>
          <Input
            name="password"
            type="password"
            icon="key"
            placeholder="******"
            onChange={handleLoginChange}
          />
        </Form.Field>
        <br />
        <Button fluid size="big" type="submit" className="login-button">
          Sign In
        </Button>
      </Form>
    </>
  );

  const signUpSegment = (
    <>
      <h1>Sign Up</h1>
      <br />
      <Form onSubmit={handleRegisterSubmit}>
        <Form.Group widths="equal" style={{ display: "-webkit-box" }}>
          <Form.Field
            name="firstName"
            label="First Name"
            placeholder="First Name"
            onChange={handleRegisterChange}
            control={Input}
          />
          <Form.Field
            name="lastName"
            label="Last Name"
            placeholder="First Name"
            onChange={handleRegisterChange}
            control={Input}
          />
        </Form.Group>
        <Form.Field
          name="username"
          icon="user"
          label="Username"
          placeholder="Username"
          onChange={handleRegisterChange}
          control={Input}
        />
        <Form.Field
          name="password"
          type="password"
          icon="key"
          label="Password"
          placeholder="Password"
          onChange={handleRegisterChange}
          control={Input}
        />
        <br />
        <Button fluid size="big" type="submit" className="login-button">
          Sign Up
        </Button>
      </Form>
    </>
  );

  return (
    <CenteredWrapper>
      <Segment raised inverted className="black-base">
        <div className="left-box">
          <Logo />
          <br />
          <p>
            Bachelor thesis project by Adam Chmara <br />
            Slovak University of Technology in Bratislava <br />
            Faculty of Informatics and Information Technologies
          </p>
          <Divider horizontal inverted section>
            Don't have an account yet?
          </Divider>
          <Button onClick={() => setShowLogin(!showLogin)} inverted size="big">
            Click to Sign Up
          </Button>
        </div>
      </Segment>
      <Segment raised className="form-panel">
        {showLogin ? signInSegment : signUpSegment}
      </Segment>
    </CenteredWrapper>
  );
}

export default Login;
