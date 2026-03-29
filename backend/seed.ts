import { db } from "./db";
import { documents, chunks } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";
import { generateEmbedding } from "./rag-engine";

interface ChunkEntry {
  topic: string;
  content: string;
  contentAr: string;
  keywords: string[];
  keywordsAr: string[];
}

interface KnowledgeEntry {
  title: string;
  category: string;
  chunks: ChunkEntry[];
}

const knowledgeBase: KnowledgeEntry[] = [
  {
    title: "Khalas Palm",
    category: "Khalas",
    chunks: [
      {
        topic: "general",
        content: "Khalas is one of the most popular premium date varieties in Saudi Arabia and the UAE, known for its golden color and caramel-like taste. The tree can grow up to 20 meters tall and live for over 100 years. It begins producing fruit 4-8 years after planting and reaches full production at 15 years. Khalas dates are medium-sized with a soft, moist texture when fresh. The variety is particularly prized in Al-Ahsa region of Saudi Arabia, which produces some of the finest Khalas dates in the world.",
        contentAr: "الخلاص من أشهر أصناف التمور الفاخرة في السعودية والإمارات، معروف بلونه الذهبي وطعمه الشبيه بالكراميل. يمكن أن يصل ارتفاع النخلة إلى 20 مترًا وتعيش أكثر من 100 عام. تبدأ بالإنتاج بعد 4-8 سنوات من الزراعة وتصل لأقصى إنتاج عند 15 سنة. تمور الخلاص متوسطة الحجم ذات قوام طري ورطب. يتميز صنف الخلاص بشكل خاص في منطقة الأحساء بالمملكة العربية السعودية التي تنتج أجود تمور الخلاص في العالم.",
        keywords: ["khalas", "premium", "golden", "caramel", "al-ahsa", "variety", "description", "overview"],
        keywordsAr: ["خلاص", "فاخر", "ذهبي", "كراميل", "الأحساء", "صنف", "وصف"],
      },
      {
        topic: "general",
        content: "Khalas dates undergo several ripening stages: Hababouk (immature green), Kimri (green and hard), Khalal (yellow/red and crunchy), Bisr (partially ripe), Rutab (soft and moist), and Tamr (fully dried). Each stage has distinct characteristics and culinary uses. The Khalal stage Khalas dates are particularly popular eaten fresh. At the Rutab stage, they develop their signature caramel flavor. Khalas trees are monoecious and require manual or assisted pollination for fruit production.",
        contentAr: "تمر تمور الخلاص بعدة مراحل نضج: الحبابوك (أخضر غير ناضج)، الكمري (أخضر وصلب)، الخلال (أصفر/أحمر ومقرمش)، البسر (ناضج جزئيًا)، الرطب (طري ورطب)، والتمر (مجفف بالكامل). لكل مرحلة خصائص واستخدامات طهي مميزة. تمور الخلاص في مرحلة الخلال تؤكل طازجة بشكل خاص. في مرحلة الرطب تكتسب نكهة الكراميل المميزة. نخيل الخلاص أحادي المسكن ويتطلب تلقيحًا يدويًا أو مساعدًا لإنتاج الثمار.",
        keywords: ["ripening", "stages", "hababouk", "kimri", "khalal", "rutab", "tamr", "bisr", "pollination"],
        keywordsAr: ["نضج", "مراحل", "حبابوك", "كمري", "خلال", "رطب", "تمر", "بسر", "تلقيح"],
      },
      {
        topic: "irrigation",
        content: "Khalas palms require moderate irrigation. In summer, water 3-4 times a week with 150-200 liters per tree per session. In winter, once a week is sufficient with 80-100 liters. Avoid waterlogging as it can lead to root rot (Fusarium oxysporum). Drip irrigation systems work best for Khalas palms, delivering water directly to the root zone at 4-6 emitters per tree. Subsurface drip irrigation at 30-50cm depth is most efficient, reducing evaporation by 30-40%. Monitor soil moisture at 30cm and 60cm depths - irrigate when moisture drops below 50% field capacity.",
        contentAr: "تحتاج نخيل الخلاص إلى ري معتدل. في الصيف، الري 3-4 مرات أسبوعيًا بمعدل 150-200 لتر لكل نخلة في كل ري. في الشتاء مرة واحدة أسبوعيًا بمعدل 80-100 لتر. تجنب التشبع بالماء لأنه يؤدي إلى تعفن الجذور (فيوزاريوم). نظام الري بالتنقيط هو الأفضل لنخيل الخلاص، حيث يوصل الماء مباشرة لمنطقة الجذور عبر 4-6 نقاطات لكل نخلة. الري بالتنقيط تحت السطحي على عمق 30-50 سم هو الأكثر كفاءة ويقلل التبخر بنسبة 30-40%. راقب رطوبة التربة على عمق 30 سم و60 سم وأروِ عندما تنخفض الرطوبة عن 50% من السعة الحقلية.",
        keywords: ["irrigation", "water", "drip", "summer", "winter", "moisture", "emitter", "subsurface", "root", "waterlogging"],
        keywordsAr: ["ري", "ماء", "تنقيط", "صيف", "شتاء", "رطوبة", "جذور", "تشبع"],
      },
      {
        topic: "harvest",
        content: "Harvest Khalas dates when they reach the 'Rutab' stage (half-ripe) for best texture, typically in late summer (August-September). The fruits should have a golden-amber color and soft, caramel-like consistency. Use sharp pruning shears to cut the entire bunch. Handle carefully to avoid bruising. Average yield is 70-120 kg per mature tree per season. For commercial harvesting, use hydraulic lifts for tall trees. Post-harvest, sort dates by size and quality - Grade A (>25mm diameter, uniform color), Grade B (20-25mm), Grade C (<20mm). Cool dates to 5°C within 4 hours of harvest to preserve quality.",
        contentAr: "احصد تمور الخلاص عند وصولها لمرحلة الرطب (نصف ناضج) للحصول على أفضل قوام، عادة في أواخر الصيف (أغسطس-سبتمبر). يجب أن يكون لون الثمار ذهبيًا كهرمانيًا مع قوام طري يشبه الكراميل. استخدم مقص تقليم حاد لقطع العذق كاملاً. تعامل بحذر لتجنب الكدمات. متوسط الإنتاج 70-120 كجم للنخلة الناضجة في الموسم. للحصاد التجاري، استخدم الرافعات الهيدروليكية للنخيل الطويل. بعد الحصاد، صنف التمور حسب الحجم والجودة - درجة أ (قطر أكبر من 25 مم، لون موحد)، درجة ب (20-25 مم)، درجة ج (أقل من 20 مم). برّد التمور إلى 5 درجات مئوية خلال 4 ساعات من الحصاد للحفاظ على الجودة.",
        keywords: ["harvest", "rutab", "yield", "pruning", "grading", "quality", "cooling", "bunch", "production"],
        keywordsAr: ["حصاد", "رطب", "إنتاج", "تقليم", "تصنيف", "جودة", "تبريد", "عذق"],
      },
      {
        topic: "pests",
        content: "Khalas palms are susceptible to Red Palm Weevil (Rhynchophorus ferrugineus), the most destructive palm pest globally. Regular monitoring is essential - look for entry holes, oozing sap, and wilting fronds. Use pheromone traps for early detection, placed every 500m in plantations. Inject infested trees with Imidacloprid at 0.5ml/L water through trunk holes. Other common pests: Dubas bug (Ommatissus lybicus) causes honeydew and sooty mold - treat with Spirotetramat; Lesser date moth (Batrachedra amydraula) attacks developing fruits - use mesh bunch covers. Integrated pest management combining biological controls (Beauveria bassiana fungus), cultural practices (sanitation, removal of infested material), and targeted pesticides is recommended.",
        contentAr: "نخيل الخلاص عرضة لسوسة النخيل الحمراء (Rhynchophorus ferrugineus)، أخطر آفات النخيل عالميًا. المراقبة المنتظمة ضرورية - ابحث عن ثقوب الدخول ونضح العصارة وذبول السعف. استخدم مصائد الفيرومونات للكشف المبكر كل 500م في المزارع. حقن الأشجار المصابة بالإيميداكلوبريد بتركيز 0.5 مل/لتر ماء عبر ثقوب الجذع. آفات أخرى شائعة: حشرة الدوباس (Ommatissus lybicus) تسبب الندوة العسلية والعفن الأسود - عالج بالسبيروتيتراميت؛ دودة التمر الصغرى (Batrachedra amydraula) تهاجم الثمار النامية - استخدم أكياس شبكية للعذوق. يُنصح بالإدارة المتكاملة للآفات التي تجمع بين المكافحة البيولوجية (فطر بوفيريا باسيانا) والممارسات الزراعية (النظافة وإزالة المواد المصابة) والمبيدات الموجهة.",
        keywords: ["pest", "weevil", "dubas", "moth", "pheromone", "trap", "insecticide", "biological", "ipm", "integrated"],
        keywordsAr: ["آفة", "سوسة", "دوباس", "دودة", "فيرومون", "مصيدة", "مبيد", "مكافحة", "متكاملة"],
      },
      {
        topic: "soil",
        content: "Khalas palms thrive in well-drained sandy loam soils with a pH between 7.0-8.0. They are moderately salt-tolerant (up to 4 dS/m ECe). Adding organic compost (20-30 kg per tree annually) improves soil structure and nutrient availability. Mulching around the base (10cm thick, 1m radius) with palm frond pieces helps retain moisture and suppress weeds. Ideal soil composition: 60-70% sand, 15-25% silt, 10-15% clay. Perform soil analysis every 2 years to monitor nutrient levels and salinity. If soil EC exceeds 6 dS/m, apply gypsum at 2-4 tons/hectare to remediate. Planting depth should be 80-100cm with a basin diameter of 2m.",
        contentAr: "تزدهر نخيل الخلاص في التربة الرملية الطميية جيدة التصريف مع حموضة بين 7.0-8.0. تتحمل الملوحة بشكل معتدل (حتى 4 ديسيسمنز/م). إضافة سماد عضوي (20-30 كجم لكل نخلة سنويًا) يحسن بنية التربة وتوفر المغذيات. تغطية التربة حول القاعدة (بسمك 10 سم ونصف قطر 1م) بقطع سعف النخيل تساعد في حفظ الرطوبة ومنع الأعشاب. التركيب المثالي للتربة: 60-70% رمل، 15-25% طمي، 10-15% طين. أجرِ تحليل تربة كل سنتين لمراقبة مستويات المغذيات والملوحة. إذا تجاوزت الموصلية الكهربائية 6 ديسيسمنز/م، أضف الجبس بمعدل 2-4 طن/هكتار. عمق الزراعة يجب أن يكون 80-100 سم مع قطر حوض 2 متر.",
        keywords: ["soil", "sandy", "loam", "ph", "salinity", "compost", "mulch", "drainage", "gypsum", "planting"],
        keywordsAr: ["تربة", "رمل", "طمي", "حموضة", "ملوحة", "سماد", "تغطية", "تصريف", "جبس", "زراعة"],
      },
      {
        topic: "nutrition",
        content: "Apply NPK fertilizer (15-15-15) three times per year: early spring (March), mid-summer (June), and fall (October). Per mature tree per application: 2-3 kg NPK. Supplement with micronutrients including iron chelate (Fe-EDDHA, 50g/tree twice yearly), zinc sulfate (100g/tree), and manganese sulfate (75g/tree). Organic fertilizers: apply 30-50 kg composted manure per tree in December-January. For fruiting trees, increase potassium during fruit set (May-June) with potassium sulfate at 1-2 kg/tree. Foliar spray with boron (Borax 0.5g/L) during flowering improves fruit set. Avoid excessive nitrogen after fruit set as it delays ripening and reduces sugar content.",
        contentAr: "أضف سماد NPK (15-15-15) ثلاث مرات سنويًا: أوائل الربيع (مارس)، منتصف الصيف (يونيو)، والخريف (أكتوبر). لكل نخلة ناضجة: 2-3 كجم NPK في كل مرة. أضف العناصر الصغرى بما فيها كيلات الحديد (Fe-EDDHA، 50 جم/نخلة مرتين سنويًا)، كبريتات الزنك (100 جم/نخلة)، وكبريتات المنغنيز (75 جم/نخلة). الأسمدة العضوية: أضف 30-50 كجم سماد بلدي متحلل لكل نخلة في ديسمبر-يناير. للنخيل المثمر، زد البوتاسيوم خلال عقد الثمار (مايو-يونيو) بكبريتات البوتاسيوم بمعدل 1-2 كجم/نخلة. رش ورقي بالبورون (بوراكس 0.5 جم/لتر) أثناء التزهير يحسن عقد الثمار. تجنب الإفراط في النيتروجين بعد عقد الثمار لأنه يؤخر النضج ويقلل نسبة السكر.",
        keywords: ["fertilizer", "npk", "nitrogen", "phosphorus", "potassium", "iron", "zinc", "manganese", "boron", "organic", "compost", "foliar"],
        keywordsAr: ["سماد", "نيتروجين", "فوسفور", "بوتاسيوم", "حديد", "زنك", "منغنيز", "بورون", "عضوي", "ورقي"],
      },
      {
        topic: "climate",
        content: "Khalas palms thrive in hot, arid climates with summer temperatures of 35-50°C and mild winters (10-20°C). They require at least 3,000 heat units (base 18°C) for proper fruit development. Optimal humidity during Rutab stage: 30-50%. High humidity above 70% during ripening causes fruit spoilage and fungal infections. Khalas can tolerate brief freezes down to -5°C but sustained cold below 0°C damages fronds and reduces yield. Wind protection is important - windbreaks of Prosopis or Casuarina at 20m spacing reduce sandblast damage to developing fruits. Annual rainfall below 100mm is ideal; excessive rain during harvest causes fruit cracking and fermentation.",
        contentAr: "تزدهر نخيل الخلاص في المناخ الحار الجاف مع درجات حرارة صيفية 35-50 درجة وشتاء معتدل (10-20 درجة). تحتاج 3000 وحدة حرارية على الأقل (أساس 18 درجة) لنمو الثمار السليم. الرطوبة المثلى أثناء مرحلة الرطب: 30-50%. الرطوبة العالية فوق 70% أثناء النضج تسبب تلف الثمار والإصابات الفطرية. يتحمل الخلاص صقيعًا قصيرًا حتى -5 درجات لكن البرد المستمر تحت الصفر يتلف السعف ويقلل الإنتاج. الحماية من الرياح مهمة - مصدات الرياح من الغاف أو الكازوارينا كل 20 مترًا تقلل أضرار الرمال على الثمار النامية. هطول أمطار سنوي أقل من 100 مم مثالي؛ الأمطار الغزيرة أثناء الحصاد تسبب تشقق الثمار وتخمرها.",
        keywords: ["climate", "temperature", "humidity", "heat", "frost", "wind", "rainfall", "arid", "season"],
        keywordsAr: ["مناخ", "حرارة", "رطوبة", "صقيع", "رياح", "أمطار", "جاف", "موسم"],
      },
      {
        topic: "propagation",
        content: "Khalas palms are propagated primarily through offshoots (fasail). Select offshoots that are 3-5 years old, weighing 10-25 kg, with established root systems. Best planting time: March-April or September-October when temperatures are moderate. After separation from mother tree, treat the cut surface with fungicide (Captan or Carbendazim). Plant in a prepared hole 1m x 1m x 1m with a mix of sand, compost, and topsoil (2:1:1 ratio). Water immediately and provide shade for first 2-3 months. Survival rate of well-selected offshoots: 85-95%. Tissue culture propagation is available commercially but is more expensive - produces genetically identical, disease-free plantlets. Spacing: 8-10m between trees in commercial plantations.",
        contentAr: "يُكثر نخيل الخلاص بشكل رئيسي عبر الفسائل. اختر فسائل عمرها 3-5 سنوات، وزنها 10-25 كجم، مع نظام جذري متطور. أفضل وقت للزراعة: مارس-أبريل أو سبتمبر-أكتوبر عندما تكون الحرارة معتدلة. بعد الفصل عن النخلة الأم، عالج سطح القطع بمبيد فطري (كابتان أو كاربندازيم). ازرع في حفرة محضرة 1م × 1م × 1م بخليط من الرمل والسماد والتربة السطحية (نسبة 2:1:1). أروِ فورًا ووفر ظلاً لأول 2-3 أشهر. معدل نجاح الفسائل المختارة جيدًا: 85-95%. الإكثار بزراعة الأنسجة متاح تجاريًا لكنه أغلى - ينتج شتلات متطابقة وراثيًا وخالية من الأمراض. المسافة: 8-10م بين النخيل في المزارع التجارية.",
        keywords: ["propagation", "offshoot", "planting", "tissue", "culture", "spacing", "nursery", "root", "fasail"],
        keywordsAr: ["إكثار", "فسيلة", "زراعة", "أنسجة", "مسافة", "مشتل", "جذور", "فسائل"],
      },
      {
        topic: "pollination",
        content: "Khalas palms require manual pollination for commercial fruit production. Male pollen is collected from male palms during February-March. Each female Khalas tree produces 10-15 bunches (spadices). Optimal pollination timing: 2-3 days after spathe opening, early morning (6-9 AM). Methods: (1) Traditional: Insert 2-3 male strands into each female bunch; (2) Mechanical: Pollen mixed with talc (1:10 ratio) applied with a duster; (3) Liquid: Pollen suspension (10g pollen + 1L water + 10g sugar) sprayed on bunches. Pollen viability decreases rapidly - use within 24 hours fresh, or store dried pollen at -20°C for up to 2 years. One male tree produces enough pollen for 25-50 female trees. Fruit set rate with proper pollination: 70-85%.",
        contentAr: "يتطلب نخيل الخلاص تلقيحًا يدويًا للإنتاج التجاري. يُجمع حبوب اللقاح من النخيل الذكري خلال فبراير-مارس. كل نخلة خلاص أنثى تنتج 10-15 عذقًا (شمراخ). التوقيت الأمثل للتلقيح: 2-3 أيام بعد تفتح الطلعة، الصباح الباكر (6-9 صباحًا). الطرق: (1) تقليدي: إدخال 2-3 خصلات ذكرية في كل عذق أنثوي؛ (2) ميكانيكي: لقاح مخلوط بالتلك (نسبة 1:10) يُطبق بالمنفاخ؛ (3) سائل: معلق لقاح (10 جم لقاح + 1 لتر ماء + 10 جم سكر) يُرش على العذوق. قابلية اللقاح تتناقص بسرعة - استخدمه خلال 24 ساعة طازجًا، أو خزّن اللقاح المجفف على -20 درجة لمدة تصل لسنتين. نخلة ذكر واحدة تكفي 25-50 نخلة أنثى. معدل عقد الثمار بالتلقيح السليم: 70-85%.",
        keywords: ["pollination", "pollen", "male", "female", "spathe", "bunch", "fruit", "set", "manual", "mechanical"],
        keywordsAr: ["تلقيح", "لقاح", "ذكر", "أنثى", "طلعة", "عذق", "ثمار", "عقد", "يدوي"],
      },
      {
        topic: "storage",
        content: "Khalas dates can be stored at different stages for varying durations. Rutab stage: refrigerate at 0-5°C for 3-6 months in sealed containers, maintaining 65-70% relative humidity. Tamr stage: store at room temperature (20-25°C) for up to 12 months in airtight containers. For long-term preservation: freeze at -18°C for up to 2 years without significant quality loss. Commercial processing: wash dates in chlorinated water (100ppm), sort by size and quality, fumigate with methyl bromide alternative (phosphine at 1.5g/m³ for 72 hours) for stored product insects. Moisture content for safe storage: Rutab 30-35%, Tamr 15-20%. Vacuum packaging extends shelf life by 40-60%. Date syrup (Dibs) production: cook dates at 80°C, extract, filter, concentrate to 70 Brix.",
        contentAr: "يمكن تخزين تمور الخلاص في مراحل مختلفة لفترات متفاوتة. مرحلة الرطب: تبريد على 0-5 درجات لمدة 3-6 أشهر في حاويات محكمة مع رطوبة نسبية 65-70%. مرحلة التمر: تخزين بدرجة حرارة الغرفة (20-25 درجة) حتى 12 شهرًا في حاويات محكمة. للحفظ طويل المدى: تجميد على -18 درجة لمدة تصل لسنتين دون فقدان كبير في الجودة. المعالجة التجارية: غسل التمور بماء مكلور (100 جزء بالمليون)، فرز حسب الحجم والجودة، تبخير بالفوسفين (1.5 جم/م³ لمدة 72 ساعة) لحشرات المخزون. نسبة الرطوبة للتخزين الآمن: رطب 30-35%، تمر 15-20%. التغليف المفرغ يمدد مدة الصلاحية بنسبة 40-60%. إنتاج دبس التمر: طبخ التمور على 80 درجة، استخلاص، تصفية، تركيز إلى 70 بركس.",
        keywords: ["storage", "refrigerate", "freeze", "shelf", "life", "packaging", "processing", "syrup", "dibs", "moisture"],
        keywordsAr: ["تخزين", "تبريد", "تجميد", "صلاحية", "تغليف", "تصنيع", "دبس", "رطوبة"],
      },
      {
        topic: "pruning",
        content: "Prune Khalas palms annually, ideally in December-January (dormant season). Remove dried, damaged, and pest-infested fronds. Maintain 80-100 green fronds on mature trees (7-8 leaf whorls). Leave a 45-degree angle between remaining fronds and trunk. Remove old fruit stalks and any offshoots not intended for propagation. Sterilize pruning tools with 10% bleach solution between trees to prevent disease spread. Heavy pruning (removing more than 30% of green fronds) reduces yield the following season by 15-25%. For young trees (under 5 years), only remove dead fronds - do not prune green fronds as they are needed for establishment.",
        contentAr: "قلّم نخيل الخلاص سنويًا، يفضل في ديسمبر-يناير (موسم السكون). أزل السعف الجاف والتالف والمصاب بالآفات. حافظ على 80-100 سعفة خضراء على النخيل الناضج (7-8 حلقات ورقية). اترك زاوية 45 درجة بين السعف المتبقي والجذع. أزل عراجين الثمار القديمة وأي فسائل غير مخصصة للإكثار. عقّم أدوات التقليم بمحلول كلور 10% بين الأشجار لمنع انتشار الأمراض. التقليم الشديد (إزالة أكثر من 30% من السعف الأخضر) يقلل الإنتاج في الموسم التالي بنسبة 15-25%. للنخيل الصغير (أقل من 5 سنوات)، أزل السعف الميت فقط ولا تقلم السعف الأخضر لأنه ضروري للنمو.",
        keywords: ["pruning", "frond", "trimming", "cutting", "sterilize", "maintenance", "canopy"],
        keywordsAr: ["تقليم", "سعف", "قص", "تعقيم", "صيانة", "تاج"],
      },
      {
        topic: "economics",
        content: "Khalas is among the highest-valued date varieties commercially. Farm-gate prices range from 15-35 SAR/kg ($4-9 USD/kg) depending on grade and season. Premium Al-Ahsa Khalas can fetch 50-80 SAR/kg in specialty markets. A mature Khalas plantation (200 trees/hectare) generates annual revenue of 200,000-500,000 SAR/hectare. Establishment cost: approximately 80,000-120,000 SAR/hectare (including land preparation, seedlings, irrigation, fencing). Break-even typically reached in year 7-9. Major export markets: UAE, Kuwait, Bahrain, Europe, and Southeast Asia. Khalas dates contribute significantly to Saudi Arabia's Vision 2030 agricultural diversification goals.",
        contentAr: "الخلاص من أعلى أصناف التمور قيمة تجاريًا. أسعار البوابة تتراوح بين 15-35 ريال/كجم حسب الدرجة والموسم. خلاص الأحساء الفاخر يصل إلى 50-80 ريال/كجم في الأسواق المتخصصة. مزرعة خلاص ناضجة (200 نخلة/هكتار) تولد إيرادات سنوية 200,000-500,000 ريال/هكتار. تكلفة التأسيس: حوالي 80,000-120,000 ريال/هكتار (شاملة إعداد الأرض والشتلات والري والتسييج). نقطة التعادل في السنة 7-9. أسواق التصدير الرئيسية: الإمارات، الكويت، البحرين، أوروبا، وجنوب شرق آسيا. تمور الخلاص تساهم بشكل كبير في أهداف التنويع الزراعي لرؤية المملكة 2030.",
        keywords: ["price", "market", "export", "revenue", "cost", "profit", "commercial", "value", "economy"],
        keywordsAr: ["سعر", "سوق", "تصدير", "إيرادات", "تكلفة", "ربح", "تجاري", "قيمة", "اقتصاد"],
      },
    ],
  },
  {
    title: "Razeez Palm",
    category: "Razeez",
    chunks: [
      {
        topic: "general",
        content: "Razeez dates are famous for their soft texture and rich, deep flavor profile. They are often used for making date syrup (Dibs/Molasses) and date paste. The variety is particularly valued in the Al-Qassim region of Saudi Arabia. Trees are vigorous growers and relatively low-maintenance compared to other premium varieties. Razeez dates are dark brown to nearly black when fully ripe, with a wrinkled skin and moist flesh. They are medium to large in size (3-5cm length) and contain a single elongated pit. The variety is well-adapted to the central Arabian Peninsula climate.",
        contentAr: "تمور الرزيز مشهورة بقوامها الطري ونكهتها الغنية العميقة. تُستخدم غالبًا لصنع دبس التمر والعجوة. يُقدّر الصنف بشكل خاص في منطقة القصيم بالمملكة العربية السعودية. الأشجار نامية بقوة وتحتاج صيانة أقل مقارنة بالأصناف الفاخرة الأخرى. تمور الرزيز بنية داكنة إلى سوداء تقريبًا عند النضج الكامل، مع قشرة مجعدة ولحم رطب. حجمها متوسط إلى كبير (3-5 سم طولاً) وتحتوي على نواة واحدة مستطيلة. الصنف متأقلم جيدًا مع مناخ وسط شبه الجزيرة العربية.",
        keywords: ["razeez", "variety", "description", "soft", "dark", "al-qassim", "overview", "flavor", "syrup"],
        keywordsAr: ["رزيز", "صنف", "وصف", "طري", "داكن", "القصيم", "نكهة", "دبس"],
      },
      {
        topic: "irrigation",
        content: "Razeez is highly drought-tolerant but produces best with consistent moisture. Deep watering twice a week in summer with 120-180 liters per tree is recommended. Reduce to once every 10 days in winter with 60-80 liters. The key is deep, infrequent watering rather than shallow, frequent irrigation. This encourages deep root development. Basin irrigation works well for Razeez in small orchards. For large plantations, bubbler irrigation (30-40 liters/hour per emitter, 4 emitters/tree) is most efficient. Reduce irrigation during the Tamr stage to increase sugar concentration. Water quality: Razeez tolerates moderately saline water up to 5,000 ppm TDS, better than most varieties.",
        contentAr: "الرزيز شديد التحمل للجفاف لكنه ينتج أفضل مع رطوبة منتظمة. الري العميق مرتين أسبوعيًا في الصيف بمعدل 120-180 لتر لكل نخلة. قلّل إلى مرة كل 10 أيام في الشتاء بمعدل 60-80 لتر. المفتاح هو الري العميق غير المتكرر بدلاً من الري السطحي المتكرر. هذا يشجع نمو الجذور العميقة. ري الأحواض يناسب الرزيز في البساتين الصغيرة. للمزارع الكبيرة، ري الفقاعات (30-40 لتر/ساعة لكل نقاطة، 4 نقاطات/نخلة) هو الأكفأ. قلّل الري خلال مرحلة التمر لزيادة تركيز السكر. جودة الماء: الرزيز يتحمل المياه المالحة المعتدلة حتى 5000 جزء بالمليون، أفضل من معظم الأصناف.",
        keywords: ["irrigation", "drought", "water", "deep", "bubbler", "basin", "saline", "tolerance", "summer", "winter"],
        keywordsAr: ["ري", "جفاف", "ماء", "عميق", "فقاعات", "حوض", "ملوحة", "تحمل", "صيف", "شتاء"],
      },
      {
        topic: "harvest",
        content: "Razeez dates are often harvested at the 'Tamr' stage (fully dried) as they have excellent storage capabilities. Harvest typically occurs in September-October, about 2-3 weeks later than Khalas. The dates should be dark brown to black in color with moisture content of 18-22%. They can be left on the tree longer than other varieties without quality loss, making harvest timing more flexible. Average yield: 80-130 kg per mature tree. Bunch weight ranges from 8-15 kg. For commercial harvesting, use nylon nets under bunches to catch naturally falling fruits. Sort into three grades: Super (uniform dark color, >3.5cm), Choice (>3cm), and Standard (remainder). Razeez dates are excellent for pressing into date paste (Ajwa-style preparation).",
        contentAr: "تُحصد تمور الرزيز غالبًا في مرحلة التمر (مجففة بالكامل) لأنها ممتازة في التخزين. الحصاد عادة في سبتمبر-أكتوبر، بعد الخلاص بحوالي 2-3 أسابيع. يجب أن يكون لونها بنيًا داكنًا إلى أسود بنسبة رطوبة 18-22%. يمكن تركها على النخلة أطول من الأصناف الأخرى دون فقدان الجودة، مما يجعل توقيت الحصاد أكثر مرونة. متوسط الإنتاج: 80-130 كجم للنخلة الناضجة. وزن العذق يتراوح بين 8-15 كجم. للحصاد التجاري، استخدم شباك نايلون تحت العذوق لالتقاط الثمار المتساقطة طبيعيًا. صنف إلى ثلاث درجات: سوبر (لون داكن موحد، أكبر من 3.5 سم)، ممتاز (أكبر من 3 سم)، وعادي (الباقي). تمور الرزيز ممتازة لصنع العجوة.",
        keywords: ["harvest", "tamr", "dried", "yield", "bunch", "grading", "storage", "flexible", "paste", "ajwa"],
        keywordsAr: ["حصاد", "تمر", "مجفف", "إنتاج", "عذق", "تصنيف", "تخزين", "عجوة"],
      },
      {
        topic: "pests",
        content: "Razeez is generally more resistant to pests than other varieties, but still requires vigilance. Main threats: Lesser Date Moth (Batrachedra amydraula) - attacks developing fruits from June onwards. Use pheromone traps for monitoring and mesh bunch covers (2mm mesh) for protection. Rhinoceros beetle (Oryctes rhinoceros) - bores into the crown area. Apply entomopathogenic nematodes (Steinernema carpocapsae) to compost heaps where larvae develop. Scale insects (Parlatoria blanchardi) - cause yellowing of fronds. Treat with white oil (2%) in early spring. Maintain clean ground cover, remove fallen fronds and fruits promptly to reduce infestation risks. Regular trunk inspection monthly helps catch Red Palm Weevil early before significant damage occurs.",
        contentAr: "الرزيز عمومًا أكثر مقاومة للآفات من الأصناف الأخرى لكنه يتطلب اليقظة. التهديدات الرئيسية: دودة التمر الصغرى (Batrachedra amydraula) - تهاجم الثمار النامية من يونيو. استخدم مصائد فيرومونات للمراقبة وأكياس شبكية (2 مم) للحماية. خنفساء وحيد القرن (Oryctes rhinoceros) - تحفر في منطقة التاج. طبّق النيماتودا الممرضة للحشرات (Steinernema carpocapsae) على أكوام السماد حيث تتطور اليرقات. الحشرات القشرية (Parlatoria blanchardi) - تسبب اصفرار السعف. عالج بالزيت الأبيض (2%) في أوائل الربيع. حافظ على نظافة الأرض، أزل السعف والثمار المتساقطة فورًا لتقليل مخاطر الإصابة.",
        keywords: ["pest", "moth", "beetle", "scale", "resistant", "trap", "nematode", "weevil", "protection"],
        keywordsAr: ["آفة", "دودة", "خنفساء", "قشرية", "مقاوم", "مصيدة", "نيماتودا", "سوسة", "حماية"],
      },
      {
        topic: "soil",
        content: "Razeez palms prefer deep sandy soils with good drainage. They can tolerate slightly alkaline conditions up to pH 8.5, broader than most date varieties. Remarkably adaptable to poor soil conditions including low-fertility desert soils. However, optimal performance is achieved in sandy loam with 2-3% organic matter content. Razeez shows superior salt tolerance - can grow in soils with ECe up to 8 dS/m (moderate salinity). For new plantations in degraded soils, amend with 50-70 kg compost per planting hole, mix with native sand at 1:2 ratio. Minimum soil depth for Razeez: 1.5m of unrestricted root zone. Avoid hardpan layers within 2m of surface.",
        contentAr: "تفضل نخيل الرزيز التربة الرملية العميقة جيدة التصريف. تتحمل ظروف قلوية طفيفة حتى pH 8.5، أوسع من معظم أصناف التمور. قابلة للتكيف بشكل ملحوظ مع ظروف التربة الفقيرة بما فيها تربة الصحراء منخفضة الخصوبة. لكن الأداء الأمثل يتحقق في التربة الرملية الطميية بنسبة مادة عضوية 2-3%. الرزيز يظهر تحمل ملوحة متفوق - يمكن أن ينمو في تربة بموصلية كهربائية حتى 8 ديسيسمنز/م (ملوحة معتدلة). للمزارع الجديدة في التربة المتدهورة، أضف 50-70 كجم سماد لكل حفرة زراعة مع خلط بالرمل المحلي بنسبة 1:2.",
        keywords: ["soil", "sandy", "alkaline", "salt", "tolerant", "drainage", "poor", "compost", "organic"],
        keywordsAr: ["تربة", "رمل", "قلوي", "ملوحة", "تحمل", "تصريف", "فقيرة", "سماد", "عضوي"],
      },
      {
        topic: "nutrition",
        content: "Razeez requires less fertilization than Khalas due to its adaptable nature. Apply a balanced fertilizer (15-15-15 NPK) twice yearly in spring (March) and late summer (August) at 1.5-2.5 kg per mature tree per application. Potassium supplementation during fruit development (May-July) improves date quality and sweetness - apply potassium sulfate at 1 kg/tree. Razeez responds well to organic fertilization: 20-40 kg well-composted manure per tree annually applied in winter (December). Micronutrient needs are lower than Khalas, but iron supplementation is still recommended in alkaline soils (iron chelate 30g/tree). Avoid over-fertilization - excessive nitrogen leads to vegetative growth at the expense of fruit production and increases pest susceptibility.",
        contentAr: "يتطلب الرزيز تسميدًا أقل من الخلاص بسبب طبيعته القابلة للتكيف. أضف سماد متوازن (NPK 15-15-15) مرتين سنويًا في الربيع (مارس) وأواخر الصيف (أغسطس) بمعدل 1.5-2.5 كجم لكل نخلة ناضجة. إضافة البوتاسيوم خلال نمو الثمار (مايو-يوليو) يحسن جودة التمور وحلاوتها - أضف كبريتات البوتاسيوم بمعدل 1 كجم/نخلة. الرزيز يستجيب جيدًا للتسميد العضوي: 20-40 كجم سماد بلدي متحلل لكل نخلة سنويًا في الشتاء (ديسمبر). احتياجات العناصر الصغرى أقل من الخلاص، لكن إضافة الحديد لا تزال مطلوبة في التربة القلوية (كيلات الحديد 30 جم/نخلة).",
        keywords: ["fertilizer", "npk", "potassium", "organic", "compost", "manure", "iron", "nutrition", "moderate"],
        keywordsAr: ["سماد", "بوتاسيوم", "عضوي", "سماد بلدي", "حديد", "تغذية", "معتدل"],
      },
      {
        topic: "climate",
        content: "Razeez thrives in the hot, continental climate of central Saudi Arabia (Najd region). Summer temperatures of 40-50°C are well-tolerated. Winter temperatures of 5-15°C are optimal for dormancy. Razeez has better cold tolerance than many Gulf varieties - can survive brief exposure to -3°C without significant damage. The variety requires 2,800-3,200 heat units for proper fruit maturation. Low humidity (20-40%) during the Tamr stage is ideal for natural drying on the tree. Razeez is relatively wind-resistant due to its robust trunk and flexible fronds, making it suitable for exposed locations. Dust storms can affect pollination if they occur during March-April flowering period.",
        contentAr: "يزدهر الرزيز في المناخ الحار القاري لوسط السعودية (منطقة نجد). حرارة الصيف 40-50 درجة تُتحمل جيدًا. حرارة الشتاء 5-15 درجة مثالية للسكون. الرزيز لديه تحمل برد أفضل من أصناف الخليج - يتحمل تعرضًا قصيرًا حتى -3 درجات. يتطلب الصنف 2,800-3,200 وحدة حرارية لنضج الثمار. الرطوبة المنخفضة (20-40%) خلال مرحلة التمر مثالية للتجفيف الطبيعي. الرزيز مقاوم نسبيًا للرياح بسبب جذعه القوي وسعفه المرن.",
        keywords: ["climate", "heat", "cold", "continental", "najd", "temperature", "humidity", "wind", "dust"],
        keywordsAr: ["مناخ", "حرارة", "برد", "قاري", "نجد", "رطوبة", "رياح", "غبار"],
      },
      {
        topic: "propagation",
        content: "Razeez produces abundant offshoots (8-15 per tree over its lifetime), making propagation straightforward. Select offshoots of 3-4 years old, weighing 8-20 kg. Razeez offshoots have a higher survival rate (90-97%) than most varieties when properly handled. Best planting season in Al-Qassim: September-November or February-March. After separation, leave offshoots to callus for 24-48 hours in shade before planting. Razeez is also popular for inter-planting with Sukkari or Safawi varieties in mixed orchards. Spacing: 7-9m between trees. Young Razeez trees grow faster than Khalas, often producing first commercial crop in year 5-6.",
        contentAr: "الرزيز ينتج فسائل وفيرة (8-15 فسيلة للنخلة طوال حياتها)، مما يجعل الإكثار سهلاً. اختر فسائل عمرها 3-4 سنوات بوزن 8-20 كجم. فسائل الرزيز لديها معدل نجاح أعلى (90-97%) من معظم الأصناف عند المعاملة الصحيحة. أفضل موسم للزراعة في القصيم: سبتمبر-نوفمبر أو فبراير-مارس. بعد الفصل، اترك الفسائل لتتصلب 24-48 ساعة في الظل قبل الزراعة. الرزيز شائع أيضًا للزراعة المختلطة مع السكري أو الصفاوي. المسافة: 7-9م بين النخيل.",
        keywords: ["propagation", "offshoot", "planting", "survival", "spacing", "nursery", "growth", "fast"],
        keywordsAr: ["إكثار", "فسيلة", "زراعة", "نجاح", "مسافة", "مشتل", "نمو", "سريع"],
      },
      {
        topic: "storage",
        content: "Razeez dates have superior natural storage capabilities due to their lower moisture content at the Tamr stage (15-18%). At room temperature in airtight containers, Tamr-stage Razeez keeps for 12-18 months. Refrigerated at 5°C: up to 24 months. Frozen at -18°C: up to 3 years with minimal quality degradation. Razeez is the preferred variety for date paste (Ajwa) production: pit, grind, press into molds at 60°C. Date syrup (Dibs): soak in warm water, extract, boil to 72 Brix, yields 40-50% of original weight. Razeez dates are also excellent for stuffed date confections. Dehydrated Razeez date powder (ground to <1mm, 5% moisture) is used as a natural sweetener and has a shelf life of 2+ years.",
        contentAr: "تمور الرزيز لديها قدرة تخزين طبيعية ممتازة بسبب انخفاض نسبة الرطوبة في مرحلة التمر (15-18%). في درجة حرارة الغرفة بحاويات محكمة، تُحفظ تمور الرزيز لمدة 12-18 شهرًا. مبردة على 5 درجات: حتى 24 شهرًا. مجمدة على -18 درجة: حتى 3 سنوات. الرزيز الصنف المفضل لإنتاج العجوة: إزالة النوى، طحن، كبس في قوالب على 60 درجة. دبس التمر: نقع في ماء دافئ، استخلاص، غلي حتى 72 بركس. مسحوق تمر الرزيز المجفف (مطحون إلى أقل من 1 مم، رطوبة 5%) يُستخدم كمُحلٍّ طبيعي ومدة صلاحيته أكثر من سنتين.",
        keywords: ["storage", "shelf", "life", "paste", "ajwa", "syrup", "dibs", "powder", "sweetener", "freeze"],
        keywordsAr: ["تخزين", "صلاحية", "عجوة", "دبس", "مسحوق", "محلي", "تجميد"],
      },
    ],
  },
  {
    title: "Shishi Palm",
    category: "Shishi",
    chunks: [
      {
        topic: "general",
        content: "Shishi is a widely cultivated variety in central and eastern Saudi Arabia, easily identified by its slightly varying color at the 'Bisar' stage where fruits show a distinctive two-tone appearance. The dates are medium-sized (2.5-4cm length) with a pleasant mild sweetness and firm texture. Popular in traditional Arabian cuisine and often served with Arabic coffee (Gahwa). The trees are well-suited to the hot, dry climate of central Saudi Arabia and are considered reliable producers. Shishi dates are reddish-brown when ripe with a slightly chewy consistency. The variety is commercially important for its consistent yields and adaptability.",
        contentAr: "الشيشي صنف مزروع على نطاق واسع في وسط وشرق السعودية، يُتعرف عليه بسهولة من لونه المتغير في مرحلة البسر حيث تظهر الثمار بمظهر ثنائي اللون مميز. التمور متوسطة الحجم (2.5-4 سم) ذات حلاوة معتدلة لطيفة وقوام متماسك. شائعة في المطبخ العربي التقليدي وتُقدم غالبًا مع القهوة العربية. الأشجار ملائمة للمناخ الحار الجاف لوسط السعودية ومنتجة بشكل موثوق. تمور الشيشي بنية محمرة عند النضج بقوام مطاطي قليلاً.",
        keywords: ["shishi", "variety", "description", "two-tone", "medium", "coffee", "overview", "bisar"],
        keywordsAr: ["شيشي", "صنف", "وصف", "ثنائي", "متوسط", "قهوة", "بسر"],
      },
      {
        topic: "irrigation",
        content: "Shishi palms prefer sandy soil with good drainage. Water frequently but lightly during the flowering season (March-May) - daily irrigation with 40-60 liters to support pollination and fruit set. In summer (June-August), irrigate 3 times weekly with 100-150 liters per tree. Reduce watering during the Tamr stage (September) to concentrate sugars in the fruit - once weekly with 50-80 liters. Shishi is moderately drought-tolerant but responds significantly to consistent irrigation with 20-30% higher yields. Surface irrigation in shallow basins (2m diameter, 15cm deep) works well. For drip systems, use 4 emitters at 8 liters/hour each. Critical irrigation period: May-July during fruit development - water stress here reduces fruit size by 15-25%.",
        contentAr: "تفضل نخيل الشيشي التربة الرملية جيدة التصريف. أروِ بشكل متكرر وخفيف أثناء موسم التزهير (مارس-مايو) - ري يومي بمعدل 40-60 لتر لدعم التلقيح وعقد الثمار. في الصيف (يونيو-أغسطس)، أروِ 3 مرات أسبوعيًا بمعدل 100-150 لتر. قلّل الري أثناء مرحلة التمر (سبتمبر) لتركيز السكر - مرة أسبوعيًا بمعدل 50-80 لتر. الشيشي متحمل للجفاف بشكل معتدل لكنه يستجيب بشكل كبير للري المنتظم مع إنتاج أعلى بنسبة 20-30%. الري السطحي في أحواض ضحلة (قطر 2م، عمق 15 سم) يعمل جيدًا.",
        keywords: ["irrigation", "water", "flowering", "drainage", "summer", "drip", "basin", "drought", "fruit"],
        keywordsAr: ["ري", "ماء", "تزهير", "تصريف", "صيف", "تنقيط", "حوض", "جفاف", "ثمار"],
      },
      {
        topic: "harvest",
        content: "Shishi harvest season starts mid-season, typically July-August for Khalal/Bisr stages and extends to September for Tamr stage. The fruits have a distinct two-tone color before fully ripening, transitioning from yellow-green to a uniform reddish-brown amber. Harvest when 60-70% of the bunch has ripened for optimal flavor. Average yield: 60-100 kg per mature tree. Shishi dates are versatile - they can be eaten at Khalal stage (crunchy, mildly sweet), Rutab stage (soft, rich), or Tamr stage (dried, concentrated sweetness). For fresh market: harvest at Rutab, pack in 500g or 1kg trays. For processing: harvest at Tamr for date bars, stuffed dates, and confections. Handle gently - Shishi dates bruise more easily than Khalas at the Rutab stage.",
        contentAr: "موسم حصاد الشيشي يبدأ في منتصف الموسم، عادة يوليو-أغسطس لمراحل الخلال/البسر ويمتد حتى سبتمبر لمرحلة التمر. الثمار لها لون ثنائي مميز قبل النضج الكامل، تتحول من أصفر-أخضر إلى بني محمر كهرماني موحد. احصد عندما ينضج 60-70% من العذق للنكهة المثلى. متوسط الإنتاج: 60-100 كجم للنخلة الناضجة. تمور الشيشي متعددة الاستخدام - تؤكل في مرحلة الخلال (مقرمشة، حلوة قليلاً)، الرطب (طرية، غنية)، أو التمر (مجففة، حلاوة مركزة). للسوق الطازج: احصد في مرحلة الرطب. للتصنيع: احصد في مرحلة التمر.",
        keywords: ["harvest", "bisar", "two-tone", "yield", "khalal", "rutab", "tamr", "versatile", "fresh", "processing"],
        keywordsAr: ["حصاد", "بسر", "ثنائي", "إنتاج", "خلال", "رطب", "تمر", "طازج", "تصنيع"],
      },
      {
        topic: "pests",
        content: "Shishi palms are prone to dust mites (Oligonychus afrasiaticus), especially in dry, hot conditions during June-August. Washing bunches with pressurized water spray (weekly) can reduce mite populations by 70-80%. For severe infestations, apply Abamectin (0.5ml/L) or sulfur dust (30g/bunch). Also susceptible to the Rhinoceros beetle (Oryctes rhinoceros) which attacks the growing point. Install light traps at 3m height to attract and capture adult beetles. Regular pruning of old fronds reduces pest harboring sites. Bird damage can be significant on Shishi - use reflective tape or nylon net covers on bunches during Rutab stage. Monitor for Red Palm Weevil using acoustic detection devices placed against the trunk monthly.",
        contentAr: "نخيل الشيشي عرضة لعناكب الغبار (Oligonychus afrasiaticus)، خاصة في الظروف الجافة الحارة خلال يونيو-أغسطس. غسل العذوق بماء مضغوط (أسبوعيًا) يقلل أعداد العناكب بنسبة 70-80%. للإصابات الشديدة، طبّق أبامكتين (0.5 مل/لتر) أو مسحوق كبريت (30 جم/عذق). عرضة أيضًا لخنفساء وحيد القرن التي تهاجم نقطة النمو. ثبّت مصائد ضوئية على ارتفاع 3م. التقليم المنتظم للسعف القديم يقلل مواقع إيواء الآفات. أضرار الطيور قد تكون كبيرة - استخدم شريطًا عاكسًا أو شباكًا على العذوق.",
        keywords: ["pest", "mite", "dust", "beetle", "rhinoceros", "bird", "trap", "spray", "sulfur", "weevil"],
        keywordsAr: ["آفة", "عنكبوت", "غبار", "خنفساء", "طيور", "مصيدة", "رش", "كبريت", "سوسة"],
      },
      {
        topic: "soil",
        content: "Shishi palms do best in light sandy soils with moderate fertility. Good drainage is essential as they are more sensitive to waterlogging than Khalas or Razeez. Add sand to heavy clay soils before planting (at least 40% sand content in planting area). Optimal soil pH: 7.0-7.5, narrower range than other varieties. Shishi has moderate salt tolerance (ECe up to 5 dS/m). Apply organic mulch (palm frond pieces, composted bark) in a 1.5m radius ring around the trunk base. Soil preparation for new planting: excavate 1.2m x 1.2m x 1m hole, fill with amended mix of native soil (50%), sand (30%), and composted manure (20%). Install drainage tiles in areas with water tables higher than 2m below surface.",
        contentAr: "تنمو نخيل الشيشي أفضل في التربة الرملية الخفيفة ذات الخصوبة المعتدلة. التصريف الجيد ضروري لأنها أكثر حساسية للتشبع بالماء من الخلاص أو الرزيز. أضف رملاً للتربة الطينية الثقيلة قبل الزراعة (40% رمل على الأقل). حموضة التربة المثلى: 7.0-7.5. الشيشي لديه تحمل ملوحة معتدل (حتى 5 ديسيسمنز/م). ضع نشارة عضوية بنصف قطر 1.5م حول قاعدة الجذع. تحضير التربة للزراعة الجديدة: حفر 1.2م × 1.2م × 1م، ملء بخليط من التربة المحلية (50%)، رمل (30%)، وسماد متحلل (20%).",
        keywords: ["soil", "sandy", "drainage", "clay", "ph", "salt", "mulch", "waterlogging", "preparation"],
        keywordsAr: ["تربة", "رمل", "تصريف", "طين", "حموضة", "ملوحة", "نشارة", "تشبع", "تحضير"],
      },
      {
        topic: "nutrition",
        content: "Apply a complete fertilizer with emphasis on potassium during fruit set (May-June). Standard program: NPK 12-12-17 (high potassium formula) at 2 kg/tree, three times yearly (March, June, September). Foliar feeding with micronutrients during the growing season improves fruit quality: spray zinc sulfate (3g/L), manganese sulfate (2g/L), and boric acid (1g/L) monthly from April to July. Organic matter application: 25-35 kg composted manure per tree in December. Avoid excessive nitrogen which promotes vegetative growth at the expense of fruit production. Shishi responds particularly well to potassium - applying extra K₂O (1.5 kg/tree of potassium sulfate in May) increases fruit sweetness by 8-12% Brix and improves color development.",
        contentAr: "أضف سمادًا كاملاً مع التركيز على البوتاسيوم أثناء عقد الثمار (مايو-يونيو). البرنامج القياسي: NPK 12-12-17 (تركيبة عالية البوتاسيوم) بمعدل 2 كجم/نخلة، ثلاث مرات سنويًا (مارس، يونيو، سبتمبر). التغذية الورقية بالعناصر الصغرى: رش كبريتات الزنك (3 جم/لتر)، كبريتات المنغنيز (2 جم/لتر)، وحمض البوريك (1 جم/لتر) شهريًا من أبريل إلى يوليو. المادة العضوية: 25-35 كجم سماد متحلل لكل نخلة في ديسمبر. تجنب الإفراط في النيتروجين. الشيشي يستجيب بشكل خاص للبوتاسيوم - إضافة كبريتات البوتاسيوم (1.5 كجم/نخلة في مايو) تزيد حلاوة الثمار بنسبة 8-12% بركس.",
        keywords: ["fertilizer", "potassium", "foliar", "zinc", "manganese", "boron", "organic", "npk", "sweetness"],
        keywordsAr: ["سماد", "بوتاسيوم", "ورقي", "زنك", "منغنيز", "بورون", "عضوي", "حلاوة"],
      },
      {
        topic: "climate",
        content: "Shishi is well-suited to the hot, dry climate of central Saudi Arabia (Riyadh and surrounding areas). Temperature tolerance: 42-48°C in summer, 5-18°C in winter. The variety needs distinct seasonal temperature variation for optimal fruit quality - the difference between summer and winter temperatures influences sugar accumulation. Heat units required: 2,600-3,000 (base 18°C). Shishi is moderately frost-sensitive - temperatures below -2°C cause frond damage and may kill young trees. Optimal humidity for fruit development: 25-45%. Shishi dates can suffer from sunscald on exposed bunches during extreme heat (>48°C) - cover bunches with breathable cloth during July-August heatwaves.",
        contentAr: "الشيشي ملائم للمناخ الحار الجاف لوسط السعودية (الرياض والمناطق المحيطة). تحمل الحرارة: 42-48 درجة في الصيف، 5-18 درجة في الشتاء. يحتاج الصنف تباين حراري موسمي واضح لجودة الثمار المثلى. الوحدات الحرارية المطلوبة: 2,600-3,000. الشيشي حساس معتدلًا للصقيع - درجات حرارة أقل من -2 تتلف السعف وقد تقتل الأشجار الصغيرة. الرطوبة المثلى لنمو الثمار: 25-45%. قد تعاني من حروق الشمس على العذوق المكشوفة في الحر الشديد (أعلى من 48 درجة).",
        keywords: ["climate", "heat", "temperature", "frost", "humidity", "season", "sunscald", "riyadh"],
        keywordsAr: ["مناخ", "حرارة", "صقيع", "رطوبة", "موسم", "حروق", "الرياض"],
      },
      {
        topic: "pollination",
        content: "Shishi palms flower from late February to early April, slightly earlier than Khalas. Each tree produces 8-12 female bunches. Manual pollination should be done within 3 days of spathe opening for best results. Shishi is somewhat less receptive to pollination than Khalas, so using fresh, high-quality pollen is important. Recommended pollen sources: use male palms known for compatibility with Shishi (Ghanami males are preferred). Apply more pollen strands per bunch (3-5 strands compared to 2-3 for Khalas). For Shishi, mechanical pollination using a pollen-talc mixture (1:8 ratio) blown into opened spathes works well. Expected fruit set: 60-75% with proper technique. Thin bunches to 8-10 per tree for optimal fruit size and quality.",
        contentAr: "تزهر نخيل الشيشي من أواخر فبراير إلى أوائل أبريل، أبكر قليلاً من الخلاص. كل نخلة تنتج 8-12 عذقًا أنثويًا. التلقيح اليدوي يجب أن يتم خلال 3 أيام من فتح الطلعة. الشيشي أقل استقبالاً للتلقيح من الخلاص، لذا استخدام لقاح طازج عالي الجودة مهم. مصادر اللقاح المفضلة: فحول غنامي. ضع خصلات لقاح أكثر لكل عذق (3-5 مقارنة بـ 2-3 للخلاص). التلقيح الميكانيكي بخليط لقاح وتلك (1:8) يعمل جيدًا. عقد الثمار المتوقع: 60-75%. خفّف العذوق إلى 8-10 لكل نخلة للحجم والجودة المثلى.",
        keywords: ["pollination", "pollen", "spathe", "flower", "male", "bunch", "thinning", "fruit", "set"],
        keywordsAr: ["تلقيح", "لقاح", "طلعة", "زهرة", "ذكر", "عذق", "خف", "ثمار", "عقد"],
      },
    ],
  },
];

async function generateEmbeddingWithRetry(text: string, maxRetries = 3): Promise<number[] | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generateEmbedding(text);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("GEMINI_API_KEY not set")) {
        return null;
      }
      if (attempt < maxRetries) {
        await new Promise(res => setTimeout(res, 1000 * attempt));
      } else {
        console.warn(`Failed to generate embedding after ${maxRetries} attempts:`, msg);
        return null;
      }
    }
  }
  return null;
}

export async function seedKnowledgeBase() {
  const existingDocs = await db.select().from(documents);
  if (existingDocs.length > 0) {
    const existingChunks = await db.select().from(chunks).where(eq(chunks.documentId, existingDocs[0].id));
    if (existingChunks.length > 0 && existingChunks[0].contentAr) {
      console.log("Knowledge base already seeded with full RAG data, skipping...");
      return;
    }
    console.log("Upgrading knowledge base to full RAG system...");
    for (const doc of existingDocs) {
      await db.delete(chunks).where(eq(chunks.documentId, doc.id));
    }
    await db.delete(documents).where(eq(documents.id, documents.id));
  }

  console.log("Seeding comprehensive RAG knowledge base...");

  for (const entry of knowledgeBase) {
    const [doc] = await db.insert(documents).values({
      title: entry.title,
      category: entry.category,
      contentType: "text",
      metadata: { source: "rag_v2", version: 2, chunksCount: entry.chunks.length },
    }).returning();

    for (let i = 0; i < entry.chunks.length; i++) {
      const chunk = entry.chunks[i];
      const embeddingText = `${chunk.topic}: ${chunk.content}`;
      const embedding = await generateEmbeddingWithRetry(embeddingText);
      await db.insert(chunks).values({
        documentId: doc.id,
        topic: chunk.topic,
        content: chunk.content,
        contentAr: chunk.contentAr,
        keywords: chunk.keywords,
        keywordsAr: chunk.keywordsAr,
        embedding: embedding ?? undefined,
        chunkIndex: i,
      });
    }
  }

  const totalChunks = knowledgeBase.reduce((sum, e) => sum + e.chunks.length, 0);
  console.log(`RAG knowledge base seeded: ${knowledgeBase.length} documents, ${totalChunks} chunks (bilingual with keywords + embeddings)`);
}

export async function backfillEmbeddings() {
  if (!process.env.GEMINI_API_KEY) {
    console.log("GEMINI_API_KEY not set — skipping embedding backfill (add key to enable semantic search)");
    return;
  }

  const chunksWithoutEmbedding = await db.select({
    id: chunks.id,
    topic: chunks.topic,
    content: chunks.content,
  }).from(chunks).where(isNull(chunks.embedding));

  if (chunksWithoutEmbedding.length === 0) {
    console.log("All chunks already have embeddings.");
    return;
  }

  console.log(`Backfilling embeddings for ${chunksWithoutEmbedding.length} chunks...`);
  let succeeded = 0;
  let failed = 0;

  for (const chunk of chunksWithoutEmbedding) {
    const embeddingText = `${chunk.topic}: ${chunk.content}`;
    const embedding = await generateEmbeddingWithRetry(embeddingText);
    if (embedding) {
      await db.update(chunks).set({ embedding }).where(eq(chunks.id, chunk.id));
      succeeded++;
    } else {
      failed++;
    }
    await new Promise(res => setTimeout(res, 200));
  }

  console.log(`Embedding backfill complete: ${succeeded} succeeded, ${failed} failed`);
}
