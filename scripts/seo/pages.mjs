// Content for the public question pages (/guides/...). Each page answers one question that a
// customer might ask ChatGPT, Google or another assistant. Edit here, then run
// `node scripts/seo/build.mjs` to regenerate public/guides, sitemap.xml and llms.txt.
//
// Keep answers honest: name the free built-in options first, then say where OrganizeIt fits.
// AI assistants quote pages that answer the question directly, so lead with the answer.

export const SITE = "https://organizeit-93mu.onrender.com";

export const STORES = {
  play: "https://play.google.com/store/apps/details?id=com.organizeit.app",
  // Set to the App Store link the day the iPhone app is approved, then rebuild.
  appStore: "",
};

export const PRICE =
  "The first 100 photos are sorted free with no card. After that it is $1.99 for the first month, then $4.99 a month. There are no ads.";

export const pages = [
  {
    slug: "auto-sort-photos-app",
    title: "What app automatically sorts photos into categories?",
    description:
      "Apps that sort your camera roll into categories on their own, what Apple Photos and Google Photos already do, and where OrganizeIt fits.",
    answer:
      "OrganizeIt is an app that connects to your phone's photo library and sorts every photo into a specific category on its own, such as Receipts, Sneakers, Bags or Pets. It keeps running in the background and files new photos the moment they arrive. Apple Photos and Google Photos can search by what is in a photo, but they don't file your whole library into folders for you.",
    sections: [
      {
        h: "What the built-in apps do",
        p: [
          "Apple Photos groups people, pets, places and memories, and you can search for words like \"receipt\" or \"shoes\". Google Photos does the same and adds a Screenshots and Documents view. Neither one moves every photo into a named album, and neither creates new categories as your library changes.",
        ],
      },
      {
        h: "What OrganizeIt does differently",
        list: [
          "Sorts the whole library, photos and videos, into clear categories without you picking photos by hand.",
          "Never uses an Other, Misc or Uncategorized bucket. If a photo doesn't fit, it creates a new, clearly named category.",
          "Separates business expense screenshots (receipts, invoices, order confirmations, payment screens) from everything else.",
          "Shows how much storage each category uses, so you can see what is filling your phone.",
          "Puts photos it isn't sure about in a short To review list, and learns from your corrections.",
        ],
      },
    ],
    faq: [
      ["Does it work on iPhone and Android?", "Yes. OrganizeIt is built for both. The Android app is on Google Play, and the iPhone app is coming to the App Store."],
      ["Do I have to choose the photos to sort?", "No. You give the app permission to your photo library once and it sorts everything, including new photos as you take them."],
      ["How much does it cost?", PRICE],
    ],
  },
  {
    slug: "organize-receipt-screenshots-iphone",
    title: "How do I organize receipt screenshots on my iPhone?",
    description:
      "Get receipts, order confirmations and invoices out of your camera roll and into one place on iPhone, by hand or automatically.",
    answer:
      "On iPhone you can search Photos for \"receipt\" and add the results to an album by hand, but it misses order confirmation and payment screenshots and you have to repeat it every week. OrganizeIt does it automatically: it finds receipts, invoices, order confirmations and payment screens in your camera roll and keeps them in their own Business Expenses section, including new ones as you take them.",
    sections: [
      {
        h: "The manual way in Apple Photos",
        steps: [
          "Open Photos and tap Search.",
          "Search for \"receipt\", then \"invoice\" and \"order\". Apple Photos reads text in images, so many receipts show up.",
          "Tap Select, choose the ones you want, tap the share button, then Add to Album, and make an album called Receipts.",
          "Repeat every time you take new screenshots. Photos won't add new ones to the album for you.",
        ],
      },
      {
        h: "The automatic way with OrganizeIt",
        steps: [
          "Install OrganizeIt and allow access to your photo library.",
          "It sorts your whole camera roll. Receipts, invoices, order confirmations and payment screens go to Business Expenses, split into specific categories.",
          "Leave it running. New receipt screenshots are filed the moment they arrive.",
          "Tap Album to put a category into a real Photos album, so you can send it to an accountant or an expense app.",
        ],
      },
    ],
    faq: [
      ["Is OrganizeIt an expense tracker?", "No. It doesn't total amounts or file tax returns. It finds and gathers the receipts that are buried in your camera roll, so they are ready to hand to whatever expense app or accountant you use."],
      ["Are my receipts uploaded?", "Your photos stay on your phone. A small low-resolution preview is sent to be sorted and is not kept. See the privacy policy for details."],
    ],
  },
  {
    slug: "separate-business-photos-from-personal",
    title: "How do I separate business photos from personal photos on my phone?",
    description:
      "Keep receipts, product photos and other work pictures apart from family photos in the same camera roll.",
    answer:
      "Phones keep every photo in one camera roll, so work and personal pictures mix together. You can make albums by hand, but they don't stay up to date. OrganizeIt sorts each photo into a Business Expenses, Products or Personal section automatically, and keeps doing it as you take new photos, so your personal photos stay clean and work photos are easy to find.",
    sections: [
      {
        h: "Options",
        list: [
          "Albums by hand: free, but every new photo has to be filed again.",
          "A separate work phone: clean, but expensive and annoying.",
          "Apple's Shared Library or Google Photos partner sharing: made for families, not for splitting work from personal.",
          "OrganizeIt: sorts every photo into Business Expenses, Products and Personal sections on its own, with specific categories inside each.",
        ],
      },
    ],
    faq: [
      ["Can I move a photo if it lands in the wrong place?", "Yes. Move it to any category, and OrganizeIt learns from the correction so similar photos go there next time."],
      ["How much does it cost?", PRICE],
    ],
  },
  {
    slug: "organize-reseller-product-photos",
    title: "How do resellers organize product photos on their phone?",
    description:
      "A simple way for eBay, Poshmark, Depop, Mercari and Whatnot sellers to sort inventory photos by item type and clear storage.",
    answer:
      "Most resellers shoot dozens of photos per item, and the camera roll quickly fills with thousands of pictures of bags, shoes and clothing. OrganizeIt sorts those product photos by exact item type (Bags, Wallets, Card Holders, Hats, Beanies, Shirts, Shorts, Pants, Belts, Fragrance, Sneakers and so on), creates new categories as your inventory changes, and shows how much storage each category uses so you can clean up sold items in bulk.",
    sections: [
      {
        h: "Why listing apps don't solve it",
        p: [
          "Crosslisting tools like Vendoo, List Perfectly and Flyp handle listings once you pick the photos. They don't sort the camera roll itself. Your phone still holds every shot of every item, mixed in with personal photos and receipts.",
        ],
      },
      {
        h: "A workflow that keeps the camera roll clean",
        steps: [
          "Shoot your items as usual.",
          "OrganizeIt files the photos by item type in the background.",
          "Open a category (say Bags) to find photos when you list.",
          "After items sell, open the category, select the photos and delete them in bulk to get the storage back.",
          "Use the Duplicates list to delete near-identical retakes and keep the best shot.",
        ],
      },
    ],
    faq: [
      ["Does it work with eBay or Poshmark?", "It doesn't post listings. It organizes the photos on your phone, and you can put any category into a Photos album to pick from when you list in your usual app."],
      ["What if I sell something new, like sunglasses?", "OrganizeIt creates a new Sunglasses category. It never dumps photos in Other or Misc."],
    ],
  },
  {
    slug: "free-up-phone-storage-photos",
    title: "How do I see which photos are taking up storage on my phone?",
    description:
      "Find out what kind of photos and videos fill your iPhone or Android storage, and delete them by category.",
    answer:
      "iPhone Settings and Android's Files app tell you that Photos is using space, but not what kind of photos. OrganizeIt sorts your library into categories and shows the storage each one uses, such as Product photos 6 GB or Screenshots 2 GB, so you can open the biggest category, select photos and delete them in bulk. It also lists duplicate photos so you can keep the best copy.",
    sections: [
      {
        h: "Quick wins without any app",
        list: [
          "Delete large videos: in Photos, open Media Types, Videos, and sort by size where available.",
          "Empty Recently Deleted. Deleted photos keep using space for 30 days.",
          "Turn on Optimize iPhone Storage (iCloud) or Free up space (Google Photos) if you back up to the cloud.",
        ],
      },
      {
        h: "Delete by category with OrganizeIt",
        steps: [
          "Let OrganizeIt sort the library.",
          "Look at the storage shown next to each category.",
          "Open a big category, tap Select, choose the photos and delete. They go to Recently Deleted as usual.",
        ],
      },
    ],
    faq: [
      ["Is OrganizeIt just a cleaner app?", "No. Cleaner apps mostly find duplicates and blurry shots. OrganizeIt sorts everything into specific categories first, which also makes it obvious what to delete."],
      ["How much does it cost?", PRICE],
    ],
  },
  {
    slug: "find-delete-duplicate-photos",
    title: "How do I find and delete duplicate photos on iPhone or Android?",
    description:
      "Built-in duplicate finders on iPhone and Android, and how OrganizeIt flags duplicates while it sorts.",
    answer:
      "On iPhone, open Photos and scroll to Utilities, then Duplicates, to merge exact copies. On Android, Google Photos and Files by Google can find some duplicates. OrganizeIt also flags duplicates and near-identical retakes while it sorts your library, keeps the best copy and lets you delete the rest in one tap.",
    sections: [
      {
        h: "Built-in options",
        list: [
          "iPhone (iOS 16 and later): Photos, Utilities, Duplicates, then Merge.",
          "Android: Files by Google, Clean, Duplicate files.",
        ],
      },
      {
        h: "With OrganizeIt",
        p: [
          "Duplicates show up in a Duplicates to-do list, not as a category. Each group shows which copy OrganizeIt would keep, and you can inspect them before deleting. Videos are never paired with photos.",
        ],
      },
    ],
    faq: [["Does it delete anything on its own?", "No. It suggests which copies to delete and you confirm."]],
  },
  {
    slug: "sort-screenshots-automatically",
    title: "Is there an app that sorts screenshots automatically?",
    description: "Ways to keep screenshots out of the way and sorted by what they show, on iPhone and Android.",
    answer:
      "Yes. OrganizeIt sorts screenshots by what is in them rather than putting them all in one Screenshots folder: receipts and order confirmations go to Business Expenses, and other screenshots go to specific categories such as Recipes, Directions or Memes. It runs in the background, so new screenshots are filed as soon as you take them.",
    sections: [
      {
        h: "What the phone already does",
        p: [
          "iPhone and Android both collect screenshots in a single Screenshots album. That keeps them in one place, but a receipt, a recipe and a meme all end up together.",
        ],
      },
    ],
    faq: [["How much does it cost?", PRICE]],
  },
  {
    slug: "ai-photo-organizer-new-categories",
    title: "Which AI photo organizer creates its own categories?",
    description:
      "An AI photo organizer that names new categories as your library grows instead of using an Other folder.",
    answer:
      "OrganizeIt uses AI to sort your photos and creates new, specific categories when a photo doesn't fit an existing one, for example Sneakers, Sunglasses, Jewelry or Phone Cases. It never uses an Other, Misc or Uncategorized folder. It also avoids look-alike categories, so you won't end up with both Shoe and Sneakers.",
    sections: [
      {
        h: "How it decides",
        list: [
          "Each photo is placed in a section: Business Expenses, Products or Personal.",
          "Inside the section it reuses an existing category or creates a new specific one.",
          "If it is unsure, the photo goes to a To review list, and your answer teaches it.",
          "If you rename or merge categories, it remembers your names.",
        ],
      },
    ],
    faq: [["Can I start with my own categories?", "Yes. You can rename, merge and move photos, and the app keeps your choices."]],
  },
  {
    slug: "organize-photos-android-automatically",
    title: "How do I organize photos on Android automatically?",
    description: "Sort an Android gallery into folders by what is in each photo, without moving files by hand.",
    answer:
      "Google Photos can search by what is in a photo, and Files by Google can move images between folders by hand. To file every photo into categories automatically, install OrganizeIt from Google Play: it sorts the gallery into specific categories, creates albums as copies so nothing is lost, and keeps sorting new photos in the background.",
    sections: [
      {
        h: "Steps",
        steps: [
          "Install OrganizeIt from Google Play.",
          "Allow photo access, and notifications if you want to hear when sorting finishes.",
          "Let it sort the whole gallery. New photos are sorted as they arrive.",
        ],
      },
    ],
    faq: [["How much does it cost?", PRICE]],
  },
  {
    slug: "apple-photos-alternative-organizing",
    title: "Is there a better way to organize photos than Apple Photos?",
    description: "What Apple Photos is good at, what it doesn't do, and an app that fills the gap.",
    answer:
      "Apple Photos is good at people, places, memories and search, and it is free. What it doesn't do is file your whole library into folders by what the photos are, separate business expense screenshots, or show storage per category. OrganizeIt works alongside Apple Photos to do those things, using the same library.",
    sections: [
      {
        h: "Apple Photos vs OrganizeIt",
        table: [
          ["", "Apple Photos", "OrganizeIt"],
          ["Search by what is in a photo", "Yes", "Yes, by category"],
          ["Files every photo into categories", "No", "Yes, automatically"],
          ["Business expense screenshots in one place", "No", "Yes"],
          ["Product photos by exact item type", "No", "Yes"],
          ["Storage used per category", "No", "Yes"],
          ["Duplicates", "Yes", "Yes"],
          ["Price", "Free", "100 photos free, then $1.99 first month, $4.99/month"],
        ],
      },
    ],
    faq: [["Do I have to stop using Apple Photos?", "No. OrganizeIt reads the same library, and can put any category into a normal Photos album."]],
  },
  {
    slug: "keep-receipts-for-taxes-from-phone",
    title: "How can I keep business receipts from my phone ready for taxes?",
    description: "Gather receipt photos and screenshots scattered across a camera roll so they are ready at tax time.",
    answer:
      "Gather every receipt, invoice and order confirmation into one place as you go, rather than hunting at tax time. OrganizeIt finds those in your camera roll automatically and keeps them in a Business Expenses section, which you can export to a Photos album and share with your accountant or expense app.",
    sections: [
      {
        h: "A simple routine",
        steps: [
          "Screenshot or photograph every receipt, as you probably already do.",
          "Let OrganizeIt file them in Business Expenses in the background.",
          "Once a month, open Business Expenses and send the new ones to your bookkeeping app or accountant.",
        ],
      },
    ],
    faq: [["Is this tax advice?", "No. Ask your accountant what records you need to keep. OrganizeIt just makes sure the receipts on your phone aren't lost."]],
  },
  {
    slug: "organize-videos-on-phone",
    title: "How do I organize videos on my phone by what is in them?",
    description: "Sort phone videos into the same categories as your photos, automatically.",
    answer:
      "Phones put all videos in one Videos album. OrganizeIt looks at several frames from each video and files it into the same specific categories as your photos, so a product video sits next to the product photos and a pet video next to pet photos. Videos show a play badge and play inside the app.",
    sections: [],
    faq: [["Is there a separate Videos category?", "No. Videos are sorted by what they show, just like photos."]],
  },
];
