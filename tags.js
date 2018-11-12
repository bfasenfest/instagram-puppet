#! /usr/bin/env node

var fs = require("fs-extra");
var request = require("request");
var now = require("performance-now");
var chalk = require("chalk");
var clear = require("clear");
var ora = require("ora");
var figlet = require("figlet");
var inquirer = require("inquirer");
const puppeteer = require("puppeteer");

var itemsBeingProcessed = 0;
var fileQueue = [];
var maxItems = 10;
var counter = 0;
var responses = {};

var status = {};

var t0 = now(),
  t1 = 0;

var outputFilename = "./jsons/crawled_media.json";

clear();
console.log(
  chalk.red(
    figlet.textSync("Insta Downloader", { horizontalLayout: "default" })
  )
);

getLocations();

function getLocations(callback) {
  var questions = [
    {
      name: "tags",
      type: "input",
      default: "photo",
      message: "Enter tags seperated by commas",
      validate: function(value) {
        if (value.length) {
          return true;
        } else {
          return "Please enter a location";
        }
      }
    }
  ];

  inquirer.prompt(questions).then(getDir);
}

function getDir(answers) {
  let arr = answers.tags.split(",");
  responses.tags = [];

  arr.forEach((tag, index) => {
    tag = tag.trim();
    if (tag.length != "") responses.tags.push(tag);
  });

  let manyTags = responses.tags.length !== 1;
  let defaultTag = !manyTags
    ? "./" + responses.tags[0].replace(/ /g, "") + "/"
    : "./images/";

  var questions = [
    {
      name: "itemType",
      message: "What type of tag?",
      type: "list",
      choices: ["Location", "Hashtag"]
    },
    {
      name: "maxImages",
      type: "input",
      message: "How many images do you want to download?",
      default: 100,
      validate: function(value) {
        var isValid = !Number.isNaN(value);
        return isValid || "This should be an integer number!";
      }
    },
    {
      name: "location",
      type: "input",
      message: "Enter location to save",
      default: defaultTag, // './' + responses.tags[0] + '/',
      validate: function(value) {
        if (value.length) {
          return true;
        } else {
          return "Please enter a location";
        }
      }
    },
    {
      message: "Create folders for each Location?",
      type: "confirm",
      name: "useFolders",
      default: manyTags
    },
    {
      name: "waitInterval",
      type: "input",
      message: "How long should chrome wait between page loads (ms)?",
      default: 1500,
      validate: function(value) {
        var isValid = !Number.isNaN(value);
        return isValid || "This should be an integer number!";
      }
    },
    {
      message: "Display scraping with Chrome?",
      type: "confirm",
      name: "headless",
      default: false
    }
  ];

  inquirer.prompt(questions).then(function() {
    responses = { ...responses, ...arguments[0] }; // responses.location = arguments[0].location
    if (!responses.maxImages) responses.maxImages = 10;
    if (responses.maxImages == 0) responses.maxImages = 100000;
    if (responses.waitInterval < 300) responses.waitInterval = 300;

    responses.length = responses.maxImages * responses.tags.length;
    initDownload();
  });
}

function initDownload() {
  let tags = [];
  responses.tags.forEach(name => {
    let tag = {};
    tag.name = name.replace(/^\s+|\s+$/g, "");

    let pageBase = "";

    switch (responses.itemType) {
      case "Location":
        pageBase = "https://www.instagram.com/explore/locations/";
        break;
      case "Hashtag":
        pageBase = "https://www.instagram.com/explore/tags/";
        break;
      case "Username":
        pageBase = "https://www.instagram.com/";
        break;
    }

    tag.page = pageBase + tag.name;
    tag.location = responses.location;
    if (responses.useFolders && responses.tags.length > 1)
      tag.location += "/" + tag.name.replace(/ /g, "") + "/";
    if (tag.name !== "") tags.push(tag);
    fs.ensureDirSync(tag.location);
    if (!fs.existsSync(tag.location)) {
      fs.mkdirSync(tag.location);
    }
  });

  status.tags = ora({
    text: "Scraping Location Info",
    spinner: "dots2"
  }).start();

  var browseObj, broswer, page;

  asyncForEach(tags, async (tag, index) => {
    if (!browseObj) {
      browseObj = await startBrowser();
      browser = browseObj.browser;
      page = browseObj.page;
    }
    let images = await getImages(tag, page);

    let outputDirectory = "./jsons/" + tag.name + "_media.json";
    writeFile(outputDirectory, images);

    if (index == tags.length - 1) browser.close();
  });
}

async function startBrowser() {
  let height = 1000;
  let width = 1600;
  const browser = await puppeteer.launch({ headless: !responses.headless });
  const page = await browser.newPage();
  await page.setViewport({ width, height });

  const {
    targetInfos: [{ targetId }]
  } = await browser._connection.send("Target.getTargets");

  // Tab window.
  const { windowId } = await browser._connection.send(
    "Browser.getWindowForTarget",
    { targetId }
  );

  await browser._connection.send("Browser.setWindowBounds", {
    bounds: { height, width },
    windowId
  });

  // if (responses.itemType == "Board") {
  //   await logIn(page);
  // }

  return { browser, page };
}

async function getImages(tag, page) {
  let tagUrl = encodeURIComponent(tag.name);

  await page.goto(tag.page);
  await page.waitFor(2000);

  const bodyHandle = await page.$("body");
  const { height } = await bodyHandle.boundingBox();
  await bodyHandle.dispose();

  // Scroll one viewport at a time, pausing to let content load
  const viewportHeight = page.viewport().height;

  let images = [];
  for (i = 1; i <= responses.maxImages; i++) {
    let sel = getImageSel(i);

    // await scrollAndWait(page, i)

    let image = await page.evaluate(
      (i, sel) => {
        let data = {};
        let item = document.querySelector(sel); //('div.GrowthUnauthPin_brioPin')
        data.imgSrc = item ? item.getAttribute("src") : "";
        data.id = item
          ? item.parentNode.parentNode.parentNode
              .getAttribute("href")
              .split("/")[2]
          : "";
        data.index = i;
        console.log(data.id);
        return data;
      },
      i,
      sel
    );

    if (i % 9 == 0) {
      await page.evaluate(_viewportHeight => {
        window.scrollBy(0, _viewportHeight);
      }, viewportHeight);
      await page.waitFor(Number(responses.waitInterval));
    }

    if ((i >= 25 && i <= 27) || (i >= 37 && i <= 48)) {
      counter++;
      continue;
    }
    processImage(image, tag);
    images.push(image);
  }
  return images;
}

async function logIn(page) {
  await page.goto("https://www.pinterest.com/");
  await page.click(
    "body > div:nth-child(3) > div > div > div > div > div:nth-child(4) > div > div:nth-child(2) > button"
  ); // Log in Button
  await page.waitFor(500);
  await page.click("#email");
  await page.waitFor(500);
  await page.keyboard.type("pinterestdownloader@gmail.com");
  await page.waitFor(500);
  await page.click("#password");
  await page.waitFor(500);
  await page.keyboard.type("downloader!");
  await page.waitFor(500);
  await page.click(
    "body > div.App.AppBase.Module > div > div.mainContainer > div > div > div > div > div > div > div:nth-child(2) > form > button"
  );
  await page.waitForNavigation();
}

function processImage(image, tag) {
  if (itemsBeingProcessed > maxItems) {
    fileQueue.push(image);
    return;
  }

  itemsBeingProcessed += 1;
  saveImage(image, tag);
}

function saveImage(image, tag) {
  let link = image.imgSrc;
  let index = image.index;
  let name = index + "-" + image.id;
  let folder = tag.location || "./";

  // name = name.replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '').trim()
  // if (name.length > 20) name = name.slice(0,40).replace(/\s/g,'')

  let stream = fs.createWriteStream(folder + name + ".jpg");

  if (link) {
    request(link)
      .on("error", function(err) {
        console.log(err);
      })
      .pipe(stream);
  } else {
    counter++;
    finishImage(tag);
  }
  stream.on("finish", () => {
    counter++;
    finishImage(tag);
    if (counter == responses.length) {
      status.downloading.succeed();
      ora("Complete").succeed();
      t1 = now();
      let secs = ((t1 - t0) / 1000).toFixed(1);
      console.log(
        "Output took " + secs + " seconds ( " + secs / 60 + " minutes)"
      );
    }
  });
}

function finishImage(tag) {
  itemsBeingProcessed -= 1;
  if (!status.downloading) {
    status.tags.succeed();
    status.downloading = ora("Downloading Images...").start();
  }
  status.downloading.text = `Processed ${counter} of ${
    responses.length
  } total | tag: ${tag.name}`; // process.stdout.write(`\rprocessed ${counter} of ${responses.length} total / working on ... ${topic.name} `)
  if (itemsBeingProcessed <= maxItems && fileQueue.length > 0) {
    processImage(fileQueue.shift(), tag);
  }
}

function writeFile(outputName = outputFilename, data, callback) {
  if (typeof data !== "string") {
    data = JSON.stringify(data);
  }

  fs.writeFile(outputName, data, function(err) {
    if (err) {
      console.log("error saving data:");
      console.log(err);
    }

    if (callback) {
      callback(err);
    }
  });
}

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

function getImageSel(num) {
  let row = Math.ceil(num / 3);
  let col = num - (row - 1) * 3;
  if (row > 9) {
    row = 9 + ((row - 1) % 3);
  }

  let tagModifier;
  switch (responses.itemType) {
    case "Location":
      tagModifier = 4;
      break;
    case "Hashtag":
      tagModifier = 3;
      break;
    case "Username":
      tagModifier = 4; // to be figured out
      break;
  }

  return (
    "#react-root > section > main > article > div:nth-child(" +
    tagModifier +
    ") > div > div:nth-child(" +
    row +
    ") > div:nth-child(" +
    col +
    ") > a > div > div.KL4Bh > img"
  );
}

async function scrollAndWait(page, i) {
  try {
    await page.waitForSelector(getPinSel(i + 10), { timeout: 500 });
    return;
    // ...
  } catch (error) {
    if (i > 10) await page.hover(getPinSel(i + 5));
    await page.waitFor(1000);
    scrollAndWait(page, i);
  }
}
