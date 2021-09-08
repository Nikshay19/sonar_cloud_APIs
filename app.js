require("dotenv").config();

const axios = require("axios").default;
const fs = require("fs");
const sodium = require("tweetsodium");

/**
  The following is the nomenclature used in this file
  Nikshay19 -> Name of the the github organisation name (get it from config)
  Calculator -> Name of the repo -> This is the team_id
  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  -> This is the admin's authToken -> get it from config

**/

// repo secrets needed for sonarcloud and github authorization are created
async function uploadTokenToRepoSecrets(arr, gitHubOrganisation, gitHubRepo) {
  for (const el of arr) {
    
    //Obtain the key from repo to generate a encrypted secret
    const { data: encKeyObject } = await axios.get(
      `https://api.github.com/repos/${gitHubOrganisation}/${gitHubRepo}/actions/secrets/public-key`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
        },
      }
    );
    const encryptedValue = encryptTokenForRepoSecret(
      encKeyObject.key,
      el.value
    );

    //Post the encrypted secret to github repo secrets
    await axios.put(
      `https://api.github.com/repos/${gitHubOrganisation}/${gitHubRepo}/actions/secrets/${el.token_name}`,
      {
        encrypted_value: encryptedValue,
        key_id: encKeyObject.key_id,
      },
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
        },
      }
    );
  }
  return "upload success";
}

//
//Create a project in sonarcloud from github repo, by integrating the github repo to sonarcloud
async function linkTosonarCloud(
  sonarToken,
  gitHubOrganisation,
  repoName,
  sonarOrganisation,
  repoId
) {
  const projectCreateReponse = await axios({
    url: "https://sonarcloud.io/api/alm_integration/provision_projects",
    method: "POST",
    auth: {
      username: sonarToken,
      password: "", // Password is not needed
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: `installationKeys=${gitHubOrganisation}%2F${repoName}%7C${repoId}&organization=${sonarOrganisation}`,
  });

  //trigger autoscan to get metrics
  const triggerAutoScan = await axios.get(
    `https://sonarcloud.io/api/autoscan/eligibility?autoEnable=true&projectKey=${projectCreateReponse.data.projects[0].projectKey}`
  );
  console.log(triggerAutoScan.data);

  return projectCreateReponse;
}

async function pushBuildFile(path, gitHubOrganisation, repo, commitMessage) {
  let content = fs.readFileSync("build.yml", "base64");

  //push the appropriate build file to initiate project analyses by sonarcloud
  const response = await axios.put(
    `https://api.github.com/repos/${gitHubOrganisation}/${repo}/contents/${path}`,
    {
      owner: gitHubOrganisation,
      repo: repo,
      message: commitMessage,
      content: content,
    },
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
      },
    }
  );
  return response;
}

async function createSonarCloudProjectAndLinkToGitHub(
  sonarAuthToken,
  gitHubOrganisation,
  gitHubRepo,
  sonarOrganisation,
  language
) {
  await uploadTokenToRepoSecrets(
    [
      {
        value: sonarAuthToken,
        token_name: "SONAR_TOKEN",
      },
      {
        value: "1234rthjrthtr556",
        token_name: "git_repo_token",
      },
    ],
    gitHubOrganisation,
    gitHubRepo
  );

  if (language !== "javascript") {
    await pushBuildFile(
      ".github/workflows/build.yml",
      gitHubOrganisation,
      gitHubRepo,
      "build"
    );
  }

  const { data } = await axios.get(
    `https://api.github.com/repos/${gitHubOrganisation}/${gitHubRepo}`
  );
  const respData = await linkTosonarCloud(
    sonarAuthToken,
    gitHubOrganisation,
    gitHubRepo,
    sonarOrganisation,
    data.id
  );

  return respData;
}

//fetch project metrics once build and analyses is complete
async function fetchMetricsFromSonarCloud(projectKey, branch) {
  const metrics = await axios.get(
    `https://sonarcloud.io/api/measures/component_tree?component=${projectKey}&branch=${branch}&metricKeys=complexity,violations,bugs,code_smells,lines,vulnerabilities&additionalFields=metrics`
  );
  return metrics;
}

createSonarCloudProjectAndLinkToGitHub(
  "f11d0b115fbdb7796f15a31aebe616f81654cb5e",
  "Nikshay19",
  "Calculator",
  "nikshay19",
  "master",
  "java"
)
  .then((res) => {
    console.log(res.data ? res.data : res);
    if (res.data && res.data.projects[0] && res.data.projects[0].projectKey) {
      return fetchMetricsFromSonarCloud(
        res.data.projects[0].projectKey,
        "master"
      );
    }

    return "unable to fetch metrics";
  })
  .then((res) => {
    console.log(res.data ? res.data : res);
  })
  .catch((err) => {
    console.log(err.response ? err.response.data : err);
  });

function encryptTokenForRepoSecret(key, value) {
  const messageBytes = Buffer.from(value);
  const keyBytes = Buffer.from(key, "base64");

  const encryptedBytes = sodium.seal(messageBytes, keyBytes);

  const encrypted = Buffer.from(encryptedBytes).toString("base64");

  return encrypted;
}
